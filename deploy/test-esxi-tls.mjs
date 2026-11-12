/**
 * CoreBit ESXi TLS/Auth diagnostic test
 *
 * Run on your server: node deploy/test-esxi-tls.mjs <host> <user> <pass> [port]
 *
 * Tests:
 *   1. TLS 1.3 connect  — hangs on some ESXi 7.0.x builds; disconnects on newer
 *   2. TLS 1.2 connect  — should complete quickly
 *   3. REST /api/session with Content-Length: 0  (required by ESXi 7.0+)
 *   4. REST /rest/.../session bare Auth           (required by ESXi 6.x)
 *   5. SOAP RetrieveServiceContent
 *   6. SOAP Login (with real password)
 *
 * Examples:
 *   node deploy/test-esxi-tls.mjs 172.16.10.40 root 'myP@ss!'
 *   node deploy/test-esxi-tls.mjs vm1.powernet.tv root 'myP@ss!'
 */

import https from 'https';

const [host, username, password, portStr] = process.argv.slice(2);
if (!host || !username || !password) {
  console.error('Usage: node test-esxi-tls.mjs <host> <user> <pass> [port]');
  process.exit(1);
}
const port = portStr ? parseInt(portStr) : 443;

function req(label, options, body) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    process.stdout.write(`  [${label}] `);
    const r = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const ms = Date.now() - t0;
        console.log(`HTTP ${res.statusCode} in ${ms}ms — ${data.slice(0, 120).replace(/\n/g, ' ')}`);
        resolve({ ok: true, status: res.statusCode, ms, body: data, headers: res.headers });
      });
    });
    r.on('error', (e) => {
      const ms = Date.now() - t0;
      console.log(`ERROR in ${ms}ms: ${e.message}`);
      resolve({ ok: false, ms, error: e.message });
    });
    r.setTimeout(8000, () => {
      const ms = Date.now() - t0;
      console.log(`TIMEOUT after ${ms}ms`);
      r.destroy();
      resolve({ ok: false, ms, error: 'timeout' });
    });
    if (body) r.write(body);
    r.end();
  });
}

function agentFor(maxVer) {
  return new https.Agent({
    rejectUnauthorized: false,
    minVersion: maxVer,
    maxVersion: maxVer,
  });
}

const soapBody = (inner) =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`;

const scXml = soapBody(`<RetrieveServiceContent xmlns="urn:vim25"><_this type="ServiceInstance">ServiceInstance</_this></RetrieveServiceContent>`);

const b64 = Buffer.from(`${username}:${password}`).toString('base64');

function escape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function run() {
  console.log(`\nCoreBit ESXi TLS Diagnostic`);
  console.log(`Node.js: ${process.version}   Host: ${host}:${port}\n`);

  console.log('── Test 1: TLS 1.3 HEAD /sdk ──');
  await req('TLS1.3', {
    hostname: host, port, path: '/sdk', method: 'HEAD',
    headers: {},
    rejectUnauthorized: false,
    minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3',
  });

  console.log('\n── Test 2: TLS 1.2 HEAD /sdk ──');
  await req('TLS1.2', {
    hostname: host, port, path: '/sdk', method: 'HEAD',
    headers: {}, agent: agentFor('TLSv1.2'),
  });

  console.log('\n── Test 3: REST /api/session WITH Content-Length: 0 (ESXi 7.0+ style) ──');
  const r7 = await req('REST-v7+CL0', {
    hostname: host, port, path: '/api/session', method: 'POST',
    headers: { 'Authorization': `Basic ${b64}`, 'Content-Length': '0' },
    agent: agentFor('TLSv1.2'),
  });
  if (r7.status === 200 || r7.status === 201) {
    console.log('  ✓ REST v7 session created! ESXi 7.0+ REST auth works.');
  }

  console.log('\n── Test 4: REST /rest/com/vmware/cis/session bare Auth (ESXi 6.x style) ──');
  const r6 = await req('REST-v6-bare', {
    hostname: host, port, path: '/rest/com/vmware/cis/session', method: 'POST',
    headers: { 'Authorization': `Basic ${b64}` },
    agent: agentFor('TLSv1.2'),
  });
  if (r6.status === 200 || r6.status === 201) {
    console.log('  ✓ REST v6 session created! ESXi 6.x REST auth works.');
  }

  console.log('\n── Test 5: SOAP RetrieveServiceContent ──');
  const scRes = await req('SOAP-SC', {
    hostname: host, port, path: '/sdk', method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'urn:vim25/7.0',
      'Content-Length': String(Buffer.byteLength(scXml)),
    },
    agent: agentFor('TLSv1.2'),
  }, scXml);

  if (!scRes.ok || scRes.status !== 200) {
    console.log('\nSOAP RetrieveServiceContent failed — cannot test Login.');
    return;
  }

  const smMatch = scRes.body.match(/<sessionManager[^>]*>([^<]+)<\/sessionManager>/);
  const sm = smMatch ? smMatch[1].trim() : 'sessionManager';
  console.log(`  sessionManager MOR: ${sm}`);

  console.log('\n── Test 6: SOAP Login ──');
  const loginXml = soapBody(
    `<Login xmlns="urn:vim25"><_this type="SessionManager">${sm}</_this><userName>${escape(username)}</userName><password>${escape(password)}</password></Login>`
  );
  const loginRes = await req('SOAP-Login', {
    hostname: host, port, path: '/sdk', method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'urn:vim25/7.0',
      'Content-Length': String(Buffer.byteLength(loginXml)),
    },
    agent: agentFor('TLSv1.2'),
  }, loginXml);

  let sessionCookieValue = null;

  if (loginRes.status === 200) {
    const cookieHdr = loginRes.headers['set-cookie'];
    const cookies = Array.isArray(cookieHdr) ? cookieHdr : (cookieHdr ? [cookieHdr] : []);
    const sessionCookieFull = cookies.find(c => c.includes('vmware_soap_session'));
    if (sessionCookieFull) {
      const m = sessionCookieFull.match(/vmware_soap_session=([^;]+)/);
      sessionCookieValue = m ? m[1] : null;
      console.log(`  ✓ SOAP Login succeeded! Cookie value: ${(sessionCookieValue ?? '').slice(0, 40)}...`);
    } else {
      console.log(`  SOAP Login HTTP 200 but no session cookie in response headers`);
    }
  } else {
    const fault = loginRes.body.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1] ?? 'check credentials';
    console.log(`  ✗ SOAP Login failed (HTTP ${loginRes.status}): ${fault}`);
    return;
  }

  if (!sessionCookieValue) {
    console.log('\nNo session cookie — cannot test VM listing.');
    return;
  }

  // Extract rootFolder and propertyCollector MORs from ServiceContent
  const rootFolderMatch = scRes.body.match(/<rootFolder[^>]*>([^<]+)<\/rootFolder>/);
  const pcMatch = scRes.body.match(/<propertyCollector[^>]*>([^<]+)<\/propertyCollector>/);
  const rootFolder = rootFolderMatch ? rootFolderMatch[1].trim() : 'ha-folder-root';
  const pc = pcMatch ? pcMatch[1].trim() : 'ha-property-collector';
  console.log(`  rootFolder MOR: ${rootFolder}   propertyCollector MOR: ${pc}`);

  console.log('\n── Test 7: SOAP RetrievePropertiesEx (VM listing) ──');
  const vmListXml = soapBody(`
    <RetrievePropertiesEx xmlns="urn:vim25">
      <_this type="PropertyCollector">${pc}</_this>
      <specSet>
        <propSet>
          <type>VirtualMachine</type>
          <all>false</all>
          <pathSet>name</pathSet>
          <pathSet>runtime.powerState</pathSet>
        </propSet>
        <objectSet>
          <obj type="Folder">${rootFolder}</obj>
          <skip>false</skip>
          <selectSet xsi:type="TraversalSpec" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
            <name>folderTraversal</name>
            <type>Folder</type>
            <path>childEntity</path>
            <skip>false</skip>
            <selectSet><name>folderTraversal</name></selectSet>
            <selectSet><name>dcVmFolderTraversal</name></selectSet>
          </selectSet>
          <selectSet xsi:type="TraversalSpec" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
            <name>dcVmFolderTraversal</name>
            <type>Datacenter</type>
            <path>vmFolder</path>
            <skip>false</skip>
            <selectSet><name>folderTraversal</name></selectSet>
          </selectSet>
        </objectSet>
      </specSet>
      <options/>
    </RetrievePropertiesEx>`);

  const vmRes = await req('SOAP-VMs', {
    hostname: host, port, path: '/sdk', method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'urn:vim25/7.0',
      'Content-Length': String(Buffer.byteLength(vmListXml)),
      'Cookie': `vmware_soap_session=${sessionCookieValue}`,
    },
    agent: agentFor('TLSv1.2'),
  }, vmListXml);

  if (vmRes.status === 200) {
    const vms = [...vmRes.body.matchAll(/<obj[^>]*type="VirtualMachine"[^>]*>([^<]+)<\/obj>/gi)];
    const names = [...vmRes.body.matchAll(/<val[^>]*>([^<]*)<\/val>/gi)].map(m => m[1]);
    console.log(`  ✓ RetrievePropertiesEx returned HTTP 200`);
    console.log(`  Found ${vms.length} VirtualMachine object(s): ${vms.map(m => m[1]).join(', ')}`);
    console.log(`  VM names/values: ${names.slice(0, 6).join(', ')}`);
  } else {
    const fault = vmRes.body.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1] ?? vmRes.body.slice(0, 200);
    console.log(`  ✗ SOAP VM listing failed (HTTP ${vmRes.status}): ${fault}`);
  }

  console.log('\nDone.');
}

run().catch(console.error);
