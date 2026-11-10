import fs from 'node:fs';
import path from 'node:path';

export type DeltaTradingMode = 'DELTA_TESTNET' | 'LIVE_DELTA_INDIA' | 'LIVE_DELTA_GLOBAL' | 'SIMULATION_PAPER';

export interface AccountCredentials {
  apiKey: string;
  apiSecret: string;
  endpoint: string;
  wsUrl: string;
}

export interface LiveAccountCredentials extends AccountCredentials {
  region: 'INDIA' | 'GLOBAL';
}

export interface DualExchangeCredentials {
  activeMode: DeltaTradingMode;
  demo: AccountCredentials;
  live: LiveAccountCredentials;

  // Active resolved properties (for direct engine access)
  apiKey: string;
  apiSecret: string;
  tradingMode: DeltaTradingMode;
  isSimulation: boolean;
  isTestnet: boolean;
  exchangeName: string;
  endpoint: string;
  wsUrl: string;
  updatedAt?: number;
}

const CREDENTIALS_FILE = path.join(process.cwd(), '.exchange_credentials.json');

export class CredentialsManager {
  private static cachedCredentials: DualExchangeCredentials | null = null;

  /**
   * Masks an API key for safe display in UI/logs (e.g. "8sBO...Rg0")
   */
  public static maskApiKey(key: string): string {
    if (!key) return 'NOT_SET';
    const trimmed = key.trim();
    if (trimmed.length > 8) {
      return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
    }
    return '••••••••';
  }

  /**
   * Helper: Resolves active flat properties from activeMode and sub-configs
   */
  private static resolveActiveCredentials(
    activeMode: DeltaTradingMode,
    demo: AccountCredentials,
    live: LiveAccountCredentials,
    updatedAt: number
  ): DualExchangeCredentials {
    let isTestnet = false;
    let isSimulation = false;
    let apiKey = '';
    let apiSecret = '';
    let endpoint = '';
    let wsUrl = '';
    let exchangeName = '';

    if (activeMode === 'DELTA_TESTNET') {
      isTestnet = true;
      isSimulation = false;
      apiKey = demo.apiKey;
      apiSecret = demo.apiSecret;
      endpoint = demo.endpoint || 'https://cdn-ind.testnet.deltaex.org';
      wsUrl = demo.wsUrl || 'wss://socket-ind.testnet.deltaex.org';
      exchangeName = 'Delta Exchange Demo (Testnet)';
    } else if (activeMode === 'LIVE_DELTA_INDIA') {
      isTestnet = false;
      isSimulation = false;
      apiKey = live.apiKey;
      apiSecret = live.apiSecret;
      endpoint = 'https://api.india.delta.exchange';
      wsUrl = 'wss://socket.india.deltaex.org';
      exchangeName = 'Delta Exchange India (Live)';
    } else if (activeMode === 'LIVE_DELTA_GLOBAL') {
      isTestnet = false;
      isSimulation = false;
      apiKey = live.apiKey;
      apiSecret = live.apiSecret;
      endpoint = 'https://api.delta.exchange';
      wsUrl = 'wss://socket.delta.exchange';
      exchangeName = 'Delta Exchange Global (Live)';
    } else { // SIMULATION_PAPER
      isTestnet = true;
      isSimulation = true;
      apiKey = demo.apiKey || live.apiKey || '';
      apiSecret = demo.apiSecret || live.apiSecret || '';
      endpoint = demo.endpoint || 'https://cdn-ind.testnet.deltaex.org';
      wsUrl = demo.wsUrl || 'wss://socket-ind.testnet.deltaex.org';
      exchangeName = 'Delta Paper Trading (Simulation)';
    }

    const creds: DualExchangeCredentials = {
      activeMode,
      demo,
      live,
      apiKey,
      apiSecret,
      tradingMode: activeMode,
      isSimulation,
      isTestnet,
      exchangeName,
      endpoint,
      wsUrl,
      updatedAt,
    };

    this.cachedCredentials = creds;
    return creds;
  }

  /**
   * Loads credentials prioritizing persistent .exchange_credentials.json over .env
   */
  public static loadCredentials(): DualExchangeCredentials {
    let activeMode: DeltaTradingMode = 'DELTA_TESTNET';
    let demoConfig: AccountCredentials = {
      apiKey: '',
      apiSecret: '',
      endpoint: 'https://cdn-ind.testnet.deltaex.org',
      wsUrl: 'wss://socket-ind.testnet.deltaex.org',
    };
    let liveConfig: LiveAccountCredentials = {
      apiKey: '',
      apiSecret: '',
      region: 'INDIA',
      endpoint: 'https://api.india.delta.exchange',
      wsUrl: 'wss://socket.india.deltaex.org',
    };
    let updatedAt = Date.now();

    // 1. Read persistent configuration file first (survives deploys without editing .env)
    try {
      if (fs.existsSync(CREDENTIALS_FILE)) {
        const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf-8').trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            if (parsed.activeMode) {
              activeMode = parsed.activeMode;
            } else if (parsed.tradingMode) {
              activeMode = parsed.tradingMode;
            }

            // Demo settings
            if (parsed.demo && typeof parsed.demo === 'object') {
              demoConfig = {
                apiKey: parsed.demo.apiKey ? String(parsed.demo.apiKey).trim() : '',
                apiSecret: parsed.demo.apiSecret ? String(parsed.demo.apiSecret).trim() : '',
                endpoint: parsed.demo.endpoint || 'https://cdn-ind.testnet.deltaex.org',
                wsUrl: parsed.demo.wsUrl || 'wss://socket-ind.testnet.deltaex.org',
              };
            }

            // Live settings
            if (parsed.live && typeof parsed.live === 'object') {
              const region = parsed.live.region === 'GLOBAL' ? 'GLOBAL' : 'INDIA';
              liveConfig = {
                apiKey: parsed.live.apiKey ? String(parsed.live.apiKey).trim() : '',
                apiSecret: parsed.live.apiSecret ? String(parsed.live.apiSecret).trim() : '',
                region,
                endpoint: parsed.live.endpoint || (region === 'GLOBAL' ? 'https://api.delta.exchange' : 'https://api.india.delta.exchange'),
                wsUrl: parsed.live.wsUrl || (region === 'GLOBAL' ? 'wss://socket.delta.exchange' : 'wss://socket.india.deltaex.org'),
              };
            }

            // Backwards compatibility with single apiKey/apiSecret in JSON
            if (parsed.apiKey && (!demoConfig.apiKey && !liveConfig.apiKey)) {
              if (parsed.isTestnet || parsed.tradingMode === 'DELTA_TESTNET') {
                demoConfig.apiKey = String(parsed.apiKey).trim();
                demoConfig.apiSecret = parsed.apiSecret ? String(parsed.apiSecret).trim() : '';
              } else {
                liveConfig.apiKey = String(parsed.apiKey).trim();
                liveConfig.apiSecret = parsed.apiSecret ? String(parsed.apiSecret).trim() : '';
              }
            }

            if (parsed.updatedAt) updatedAt = parsed.updatedAt;
          }
        }
      }
    } catch (e: any) {
      console.warn('⚠️ [CredentialsManager] Error parsing .exchange_credentials.json:', e.message);
    }

    // 2. Fallback to process.env (.env file) if keys are missing
    const envApiKey = process.env.DELTA_API_KEY || process.env.EXCHANGE_API_KEY || '';
    const envApiSecret = process.env.DELTA_API_SECRET || process.env.EXCHANGE_API_SECRET || '';
    const isTestnetEnv = process.env.DELTA_IS_TESTNET === 'true';

    if (!demoConfig.apiKey && (isTestnetEnv || !liveConfig.apiKey)) {
      demoConfig.apiKey = envApiKey;
      demoConfig.apiSecret = envApiSecret;
    }
    if (!liveConfig.apiKey && !isTestnetEnv && envApiKey) {
      liveConfig.apiKey = envApiKey;
      liveConfig.apiSecret = envApiSecret;
    }

    // 3. Resolve active configuration
    return this.resolveActiveCredentials(activeMode, demoConfig, liveConfig, updatedAt);
  }

  /**
   * Updates credentials in-memory and permanently saves both Demo and Normal Live settings to .exchange_credentials.json
   */
  public static saveCredentials(updates: {
    activeMode?: DeltaTradingMode;
    tradingMode?: DeltaTradingMode;
    // Demo Delta updates
    demoApiKey?: string;
    demoApiSecret?: string;
    // Normal Live Delta updates
    liveApiKey?: string;
    liveApiSecret?: string;
    liveRegion?: 'INDIA' | 'GLOBAL';
    clearDemoKeys?: boolean;
    clearLiveKeys?: boolean;
    // Backwards compatibility updates
    apiKey?: string;
    apiSecret?: string;
    isSimulation?: boolean;
    isTestnet?: boolean;
  }): DualExchangeCredentials {
    const current = this.loadCredentials();
    const demo: AccountCredentials = { ...current.demo };
    const live: LiveAccountCredentials = { ...current.live };
    let activeMode: DeltaTradingMode = updates.activeMode || updates.tradingMode || current.activeMode;

    if (!updates.activeMode && !updates.tradingMode) {
      if (updates.isSimulation) {
        activeMode = 'SIMULATION_PAPER';
      } else if (updates.isTestnet !== undefined) {
        activeMode = updates.isTestnet ? 'DELTA_TESTNET' : (live.region === 'GLOBAL' ? 'LIVE_DELTA_GLOBAL' : 'LIVE_DELTA_INDIA');
      }
    }

    // Demo updates
    if (updates.clearDemoKeys) {
      demo.apiKey = '';
      demo.apiSecret = '';
    } else {
      if (updates.demoApiKey !== undefined && updates.demoApiKey.trim().length > 0) {
        demo.apiKey = updates.demoApiKey.trim();
      }
      if (updates.demoApiSecret !== undefined && updates.demoApiSecret.trim().length > 0) {
        demo.apiSecret = updates.demoApiSecret.trim();
      }
    }

    // Live updates
    if (updates.clearLiveKeys) {
      live.apiKey = '';
      live.apiSecret = '';
    } else {
      if (updates.liveApiKey !== undefined && updates.liveApiKey.trim().length > 0) {
        live.apiKey = updates.liveApiKey.trim();
      }
      if (updates.liveApiSecret !== undefined && updates.liveApiSecret.trim().length > 0) {
        live.apiSecret = updates.liveApiSecret.trim();
      }
    }
    if (updates.liveRegion) {
      live.region = updates.liveRegion;
      live.endpoint = updates.liveRegion === 'GLOBAL' ? 'https://api.delta.exchange' : 'https://api.india.delta.exchange';
      live.wsUrl = updates.liveRegion === 'GLOBAL' ? 'wss://socket.delta.exchange' : 'wss://socket.india.deltaex.org';
    }

    // Legacy fallback: single apiKey/apiSecret applied to current active environment
    if (updates.apiKey !== undefined && updates.apiKey.trim().length > 0) {
      if (activeMode === 'DELTA_TESTNET') demo.apiKey = updates.apiKey.trim();
      else live.apiKey = updates.apiKey.trim();
    }
    if (updates.apiSecret !== undefined && updates.apiSecret.trim().length > 0) {
      if (activeMode === 'DELTA_TESTNET') demo.apiSecret = updates.apiSecret.trim();
      else live.apiSecret = updates.apiSecret.trim();
    }

    const resolved = this.resolveActiveCredentials(activeMode, demo, live, Date.now());

    // Write full dual config to .exchange_credentials.json
    try {
      fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(resolved, null, 2), 'utf-8');
      console.log(`🔑 [CredentialsManager] Dual settings saved to ${CREDENTIALS_FILE} (Active: ${resolved.activeMode}, Demo Key: ${this.maskApiKey(resolved.demo.apiKey)}, Live Key: ${this.maskApiKey(resolved.live.apiKey)})`);
    } catch (e: any) {
      console.error('❌ [CredentialsManager] Failed to write .exchange_credentials.json:', e.message);
    }

    return resolved;
  }

  public static getCredentials(): DualExchangeCredentials {
    return this.cachedCredentials || this.loadCredentials();
  }

  public static getDemoCredentials(): AccountCredentials {
    return this.getCredentials().demo;
  }

  public static getLiveCredentials(): LiveAccountCredentials {
    return this.getCredentials().live;
  }

  public static getMaskedStatus(): {
    activeMode: DeltaTradingMode;
    tradingMode: DeltaTradingMode;
    isSimulation: boolean;
    isTestnet: boolean;
    exchange: string;
    endpoint: string;
    hasApiKey: boolean;
    hasApiSecret: boolean;
    maskedApiKey: string;
    updatedAt?: number;
    demo: {
      hasApiKey: boolean;
      hasApiSecret: boolean;
      maskedApiKey: string;
      endpoint: string;
      exchangeName: string;
    };
    live: {
      hasApiKey: boolean;
      hasApiSecret: boolean;
      maskedApiKey: string;
      region: 'INDIA' | 'GLOBAL';
      endpoint: string;
      exchangeName: string;
    };
  } {
    const c = this.getCredentials();
    return {
      activeMode: c.activeMode,
      tradingMode: c.tradingMode,
      isSimulation: c.isSimulation,
      isTestnet: c.isTestnet,
      exchange: c.exchangeName,
      endpoint: c.endpoint,
      hasApiKey: Boolean(c.apiKey),
      hasApiSecret: Boolean(c.apiSecret),
      maskedApiKey: this.maskApiKey(c.apiKey),
      updatedAt: c.updatedAt,
      demo: {
        hasApiKey: Boolean(c.demo.apiKey),
        hasApiSecret: Boolean(c.demo.apiSecret),
        maskedApiKey: this.maskApiKey(c.demo.apiKey),
        endpoint: c.demo.endpoint,
        exchangeName: 'Delta Exchange Demo (Testnet)',
      },
      live: {
        hasApiKey: Boolean(c.live.apiKey),
        hasApiSecret: Boolean(c.live.apiSecret),
        maskedApiKey: this.maskApiKey(c.live.apiKey),
        region: c.live.region,
        endpoint: c.live.endpoint,
        exchangeName: c.live.region === 'GLOBAL' ? 'Delta Exchange Global (Live)' : 'Delta Exchange India (Live)',
      },
    };
  }
}
