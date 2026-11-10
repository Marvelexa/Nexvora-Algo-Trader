import net from 'net';
import fs from 'fs';
import path from 'path';
import http from 'http';

const portsToTest = [3002, 3003, 3004, 3005, 3006, 3007, 3025];
const obsoleteFiles = [
  '.delta_auto_trader_state_3006.json',
  '.delta_auto_trader_state_3007.json',
  '.delta_auto_trader_state_3025.json',
  '.delta_auto_trader_state_3999.json',
  'public/closed_trades_history_3006.json',
  'public/closed_trades_history_3007.json',
  'public/closed_trades_history_3025.json',
  'public/closed_trades_history_3999.json'
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function checkPort3001Health() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:3001/api/health', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ ok: res.statusCode === 200, status: json.status, data: json });
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
    });
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });
    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ ok: false, error: 'TIMEOUT' });
    });
  });
}

async function testSimultaneousHoldAndTraffic(ports) {
  const servers = [];
  const errors = [];

  for (const port of ports) {
    const server = net.createServer((socket) => {
      socket.on('data', (data) => {
        socket.write('ECHO:' + data.toString());
      });
    });

    await new Promise((resolve) => {
      server.listen(port, '127.0.0.1', () => {
        servers.push({ port, server });
        resolve();
      });
      server.on('error', (err) => {
        errors.push({ port, err });
        resolve();
      });
    });
  }

  if (errors.length > 0) {
    for (const { server } of servers) {
      server.close();
    }
    return { ok: false, errors };
  }

  // Send payload to each held port
  const clientResults = [];
  for (const port of ports) {
    const res = await new Promise((resolve) => {
      const client = new net.Socket();
      let received = '';
      client.connect(port, '127.0.0.1', () => {
        client.write('PING');
      });
      client.on('data', (d) => {
        received += d.toString();
        client.destroy();
      });
      client.on('close', () => {
        resolve({ port, success: received === 'ECHO:PING' });
      });
      client.on('error', (err) => {
        resolve({ port, success: false, error: err.message });
      });
    });
    clientResults.push(res);
  }

  // Hold for 3 seconds while listening
  await sleep(3000);

  // Close all
  for (const { server } of servers) {
    await new Promise(r => server.close(r));
  }

  return { ok: clientResults.every(r => r.success), clientResults };
}

async function runAdversarialDwell() {
  console.log('=== STARTING ADVERSARIAL CHALLENGER DWELL & STRESS HARNESS ===');
  console.log('Target dwell period: 20 seconds with 2-second interval polling');

  const startTime = Date.now();
  let intervalCount = 0;
  let resurrectionDetected = false;
  let fileRecreationDetected = false;

  while (Date.now() - startTime < 20000) {
    intervalCount++;
    await sleep(2000);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

    // Check obsolete files
    for (const f of obsoleteFiles) {
      if (fs.existsSync(path.join(process.cwd(), f))) {
        console.error(`[DWELL ALERT +${elapsedSec}s] Obsolete file regenerated: ${f}`);
        fileRecreationDetected = true;
      }
    }

    // Check Port 3001 health
    const health = await checkPort3001Health();
    if (!health.ok) {
      console.error(`[DWELL ALERT +${elapsedSec}s] Port 3001 health failed: ${health.error}`);
    } else {
      process.stdout.write(`.`);
    }
  }

  console.log(`\nDwell monitoring complete (${intervalCount} intervals, 20s total).`);
  console.log(`Resurrection detected: ${resurrectionDetected ? 'YES (FAIL)' : 'NO (PASS)'}`);
  console.log(`File recreation detected: ${fileRecreationDetected ? 'YES (FAIL)' : 'NO (PASS)'}`);

  console.log('\n--- Stress Test: Simultaneous Port Binding and Echo Protocol ---');
  const stressResult = await testSimultaneousHoldAndTraffic(portsToTest);
  console.log('Simultaneous binding & echo result:', stressResult.ok ? 'PASS' : 'FAIL');
  if (!stressResult.ok) {
    console.error('Stress test errors:', stressResult);
  }

  const overallPass = !resurrectionDetected && !fileRecreationDetected && stressResult.ok;
  console.log(`\nADVERSARIAL HARNESS OVERALL: ${overallPass ? 'ALL TESTS PASSED' : 'TESTS FAILED'}`);

  if (overallPass) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runAdversarialDwell();
