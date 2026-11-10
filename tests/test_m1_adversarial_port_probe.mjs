import net from 'net';
import fs from 'fs';
import path from 'path';

const portsToTest = [3002, 3003, 3004, 3005, 3006, 3007, 3025];
const obsoleteStateFiles = [
  '.delta_auto_trader_state_3006.json',
  '.delta_auto_trader_state_3007.json',
  '.delta_auto_trader_state_3025.json',
  '.delta_auto_trader_state_3999.json'
];

async function probePortBinding(port, host = undefined) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err) => {
      resolve({
        port,
        host: host || 'default',
        bound: false,
        code: err.code,
        message: err.message
      });
    });

    server.once('listening', () => {
      server.close(() => {
        resolve({
          port,
          host: host || 'default',
          bound: true,
          code: null,
          message: 'SUCCESS'
        });
      });
    });

    if (host) {
      server.listen(port, host);
    } else {
      server.listen(port);
    }
  });
}

async function run() {
  console.log('===============================================================');
  console.log('       MILESTONE 1 EMPIRICAL ADVERSARIAL VERIFICATION          ');
  console.log('===============================================================\n');

  console.log('--- 1. Testing Default Port Binding (server.listen(port)) ---');
  const defaultBindResults = [];
  for (const port of portsToTest) {
    const res = await probePortBinding(port);
    defaultBindResults.push(res);
    console.log(`Port ${port} (default): ${res.bound ? 'FREE (BIND OK)' : 'OCCUPIED (' + res.code + ': ' + res.message + ')'}`);
  }

  console.log('\n--- 2. Testing Explicit IPv6 Binding (server.listen(port, "::")) ---');
  const ipv6BindResults = [];
  for (const port of portsToTest) {
    const res = await probePortBinding(port, '::');
    ipv6BindResults.push(res);
    console.log(`Port ${port} (::): ${res.bound ? 'FREE (BIND OK)' : 'OCCUPIED (' + res.code + ': ' + res.message + ')'}`);
  }

  console.log('\n--- 3. Verifying Purged State Files ---');
  const stateFilesStatus = [];
  for (const file of obsoleteStateFiles) {
    const filePath = path.join(process.cwd(), file);
    const exists = fs.existsSync(filePath);
    stateFilesStatus.push({ file, exists, size: exists ? fs.statSync(filePath).size : 0 });
    console.log(`State file ${file}: ${exists ? 'EXISTS (VIOLATION - SHOULD BE PURGED)' : 'PURGED (OK)'}`);
  }

  const defaultFailures = defaultBindResults.filter(r => !r.bound);
  const ipv6Failures = ipv6BindResults.filter(r => !r.bound);
  const existingObsoleteFiles = stateFilesStatus.filter(s => s.exists);

  console.log('\n===============================================================');
  console.log('                       VERDICT SUMMARY                         ');
  console.log('===============================================================');
  console.log(`Default Port Bind Failures: ${defaultFailures.length} / ${portsToTest.length}`);
  console.log(`IPv6 Port Bind Failures:    ${ipv6Failures.length} / ${portsToTest.length}`);
  console.log(`Unpurged Obsolete Files:    ${existingObsoleteFiles.length} / ${obsoleteStateFiles.length}`);

  const passed = defaultFailures.length === 0 && ipv6Failures.length === 0 && existingObsoleteFiles.length === 0;

  if (passed) {
    console.log('\nOVERALL RESULT: PASS (All ports free, all obsolete state files purged)');
    process.exit(0);
  } else {
    console.log('\nOVERALL RESULT: FAIL (Ports occupied by running processes, state files exist)');
    process.exit(1);
  }
}

run();
