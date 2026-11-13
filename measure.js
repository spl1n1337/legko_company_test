'use strict';

const http = require('node:http');
const https = require('node:https');

const REQUESTS = 10;
const MAX_REDIRECTS = 5;

function usage() {
  console.error('Usage: node measure.js <url>');
  console.error('Example: node measure.js https://proof.ovh.net/files/1Mb.dat');
  process.exit(1);
}

function requestOnce(targetUrl, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      reject(new Error(`Invalid URL: ${targetUrl}`));
      return;
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      reject(new Error('Only http and https URLs are supported'));
      return;
    }

    const started = performance.now();
    const req = lib.get(
      parsed,
      {
        headers: {
          'accept-encoding': 'identity',
          'user-agent': 'download-speed/1.0',
        },
      },
      (res) => {
        const status = res.statusCode || 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          const next = new URL(res.headers.location, targetUrl).href;
          requestOnce(next, redirectsLeft - 1).then(resolve, reject);
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status} for ${targetUrl}`));
          return;
        }

        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
        });
        res.on('end', () => {
          resolve({
            bytes,
            elapsedMs: performance.now() - started,
          });
        });
        res.on('error', reject);
      }
    );

    req.on('error', reject);
  });
}

function formatMs(ms) {
  return `${ms.toFixed(0)} ms`;
}

async function main() {
  const url = process.argv[2];
  if (!url) usage();

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`Invalid URL: ${url}`);
    process.exit(1);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.error('Only http and https URLs are supported.');
    process.exit(1);
  }

  console.log(`URL: ${url}`);
  console.log(`Requests: ${REQUESTS}, one after another`);
  console.log('');

  let totalBytes = 0;
  let totalMs = 0;

  for (let i = 1; i <= REQUESTS; i += 1) {
    const { bytes, elapsedMs } = await requestOnce(url);
    totalBytes += bytes;
    totalMs += elapsedMs;
    const mebibytes = bytes / (1024 * 1024);
    console.log(
      `#${String(i).padStart(2, '0')}  ${formatMs(elapsedMs).padStart(8)}   ${mebibytes.toFixed(2)} MiB`
    );
  }

  const averageMs = totalMs / REQUESTS;
  const totalMebibytes = totalBytes / (1024 * 1024);
  const totalSeconds = totalMs / 1000;
  const megabitsPerSecond = (totalBytes * 8) / 1_000_000 / totalSeconds;

  console.log('');
  console.log(`Average request time: ${formatMs(averageMs)}`);
  console.log(
    `Total downloaded:     ${totalMebibytes.toFixed(2)} MiB (${totalBytes} bytes)`
  );
  console.log(`Download speed:       ${megabitsPerSecond.toFixed(2)} Mbit/s`);
}

main().catch((err) => {
  console.error(`Request failed: ${err.message}`);
  process.exit(1);
});
