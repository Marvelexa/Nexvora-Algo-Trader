"""
Risk management, position sizing, and portfolio guardrails.
Enforces Delta contract specification math, notional caps, correlation limits,
and persistent daily/weekly/drawdown halts.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Optional, Set


@dataclass(frozen=True)
class RiskLimits:
    risk_per_trade: float = 0.0025               # 0.25% of equity per trade
    max_aggregate_open_risk: float = 0.01        # 1.0% max combined open stop risk
    daily_loss_limit: float = 0.01               # 1.0% daily loss halt
    weekly_loss_limit: float = 0.025             # 2.5% weekly loss halt
    max_drawdown_halt: float = 0.05              # 5.0% max drawdown entry halt
    max_gross_equity_multiple: float = 1.0       # 1.0x gross notional cap
    max_positions: int = 4
    max_positions_per_correlation_group: int = 1


def adverse_fill(price: float, side: int, slippage: float) -> float:
    """
    Apply adverse slippage to fill price.
    side: +1 for buy (entry long or cover short), -1 for sell (entry short or sell long).
    """
    if price <= 0 or slippage < 0:
        raise ValueError(f"Invalid price ({price}) or slippage ({slippage})")
    return price * (1.0 + side * slippage)


def calculate_position_size(
    equity: float,
    risk_fraction: float,
    entry: float,
    stop: float,
    contract_multiplier: float,
    fee_rate: float,
    slippage_rate: float,
    max_gross_equity_multiple: float = 1.0,
    min_contracts: int = 1
) -> int:
    """
    Calculate position size in integer contracts according to Delta specs:
    Respects risk budget (including slippage & fees) and gross notional limit.
    """
    if min(equity, entry, stop, contract_multiplier) <= 0:
        return 0
    if entry == stop or not (0 < risk_fraction <= 1.0):
        return 0

    risk_budget = equity * risk_fraction
    price_risk_per_contract = abs(entry - stop) * contract_multiplier
    # Round-trip estimated trading costs per contract (entry + stop)
    estimated_cost_per_contract = (entry + stop) * (fee_rate + slippage_rate) * contract_multiplier
    total_risk_per_contract = price_risk_per_contract + estimated_cost_per_contract

    if total_risk_per_contract <= 0:
        return 0

    contracts_by_risk = math.floor(risk_budget / total_risk_per_contract)

    # Gross notional limit check
    notional_per_contract = entry * contract_multiplier
    if notional_per_contract <= 0:
        return 0
    max_notional = equity * max_gross_equity_multiple
    contracts_by_notional = math.floor(max_notional / notional_per_contract)

    qty = min(contracts_by_risk, contracts_by_notional)
    if qty < min_contracts:
        return 0

    return int(qty)


class PortfolioRiskManager:
    """
    Manages portfolio limits, active positions, correlation groups,
    and daily/weekly/drawdown halts.
    """

    def __init__(self, initial_equity: float, limits: Optional[RiskLimits] = None):
        self.limits = limits or RiskLimits()
        self.equity = initial_equity
        self.peak_equity = initial_equity

        self.current_day_str: Optional[str] = None
        self.day_start_equity: float = initial_equity
        self.day_closed_pnl: float = 0.0

        self.current_week_str: Optional[str] = None
        self.week_start_equity: float = initial_equity
        self.week_closed_pnl: float = 0.0

        # Open positions tracking: symbol -> dict
        self.open_positions: Dict[str, Dict] = {}

    def update_time_and_equity(self, dt_iso: str, current_equity: float):
        """Update time trackers for daily/weekly boundaries and peak equity."""
        self.equity = current_equity
        if current_equity > self.peak_equity:
            self.peak_equity = current_equity

        day_str = dt_iso[:10]  # YYYY-MM-DD
        if self.current_day_str != day_str:
            self.current_day_str = day_str
            self.day_start_equity = current_equity
            self.day_closed_pnl = 0.0

        # ISO calendar week YYYY-Www
        week_str = dt_iso[:4] + "-W" + str(math.floor(int(dt_iso[8:10]) / 7) + 1)
        if self.current_week_str != week_str:
            self.current_week_str = week_str
            self.week_start_equity = current_equity
            self.week_closed_pnl = 0.0

    def record_closed_pnl(self, net_pnl: float):
        """Update P&L trackers upon trade closure."""
        self.day_closed_pnl += net_pnl
        self.week_closed_pnl += net_pnl

    def is_halted(self) -> tuple[bool, str]:
        """
        Check if trading is halted by daily loss limit,
        weekly loss limit, or max drawdown halt.
        """
        # Drawdown halt check
        if self.peak_equity > 0:
            dd = (self.peak_equity - self.equity) / self.peak_equity
            if dd >= self.limits.max_drawdown_halt:
                return True, f"Max drawdown halt reached ({dd*100:.2f}% >= {self.limits.max_drawdown_halt*100:.1f}%)"

        # Daily loss limit check
        if self.day_start_equity > 0:
            day_loss = -self.day_closed_pnl / self.day_start_equity
            if day_loss >= self.limits.daily_loss_limit:
                return True, f"Daily loss limit hit ({day_loss*100:.2f}% >= {self.limits.daily_loss_limit*100:.1f}%)"

        # Weekly loss limit check
        if self.week_start_equity > 0:
            week_loss = -self.week_closed_pnl / self.week_start_equity
            if week_loss >= self.limits.weekly_loss_limit:
                return True, f"Weekly loss limit hit ({week_loss*100:.2f}% >= {self.limits.weekly_loss_limit*100:.1f}%)"

        return False, "OK"

    def can_open_trade(
        self,
        symbol: str,
        correlation_group: str,
        planned_risk_amount: float
    ) -> tuple[bool, str]:
        """Validate whether a new trade can be opened against all portfolio constraints."""
        halted, reason = self.is_halted()
        if halted:
            return False, reason

        # Position count limit
        if len(self.open_positions) >= self.limits.max_positions:
            return False, f"Max open positions reached ({len(self.open_positions)}/{self.limits.max_positions})"

        # Already in position on this symbol
        if symbol in self.open_positions:
            return False, f"Already in position on {symbol}"

        # Correlation group limit
        corr_count = sum(1 for p in self.open_positions.values() if p.get("correlation_group") == correlation_group)
        if corr_count >= self.limits.max_positions_per_correlation_group:
            return False, f"Max positions in correlation group '{correlation_group}' reached"

        # Aggregate open risk limit
        current_open_risk = sum(p.get("risk_amount", 0.0) for p in self.open_positions.values())
        max_open_risk = self.equity * self.limits.max_aggregate_open_risk
        if (current_open_risk + planned_risk_amount) > max_open_risk:
            return False, f"Aggregate open risk limit exceeded ({current_open_risk + planned_risk_amount:.2f} > {max_open_risk:.2f})"

        return True, "Approved"
