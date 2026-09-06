/**
 * iosonofratv - Standalone IPK Packager for LG webOS Smart TV
 * Genera il pacchetto .ipk standard senza richiedere l'SDK webOS o CLI esterne.
 * Compatibile al 100% con webOS Dev Manager, Homebrew Channel e ares-cli.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createTarHeader(name, size, type = '0', mode = '0000644') {
  const buf = Buffer.alloc(512);
  buf.write(name, 0, 100, 'utf-8');
  buf.write(mode.padStart(7, '0') + '\0', 100, 8, 'ascii');
  buf.write('0000000\0', 108, 8, 'ascii'); // uid
  buf.write('0000000\0', 116, 8, 'ascii'); // gid
  const sizeOctal = size.toString(8).padStart(11, '0') + '\0';
  buf.write(sizeOctal, 124, 12, 'ascii');
  const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0';
  buf.write(mtime, 136, 12, 'ascii');
  buf.fill(' ', 148, 156); // checksum spaces
  buf.write(type, 156, 1, 'ascii');
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');

  // Calcolo Checksum UStar
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  const sumOctal = sum.toString(8).padStart(6, '0') + '\0 ';
  buf.write(sumOctal, 148, 8, 'ascii');
  return buf;
}

function makeTar(files) {
  const chunks = [];
  for (const f of files) {
    const isDir = f.isDir;
    const data = f.data || Buffer.alloc(0);
    const header = createTarHeader(f.name, data.length, isDir ? '5' : '0', isDir ? '0000755' : '0000644');
    chunks.push(header);
    if (data.length > 0) {
      chunks.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad > 0) chunks.push(Buffer.alloc(pad));
    }
  }
  // Due blocchi di zeri finali (1024 bytes)
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function makeArArchive(members) {
  const chunks = [Buffer.from('!<arch>\n', 'ascii')];
  for (const m of members) {
    const hdr = Buffer.alloc(60);
    hdr.fill(' ');
    hdr.write((m.name).padEnd(16, ' '), 0, 16, 'ascii');
    const mtime = Math.floor(Date.now() / 1000).toString().padEnd(12, ' ');
    hdr.write(mtime, 16, 12, 'ascii');
    hdr.write('0     ', 28, 6, 'ascii');
    hdr.write('0     ', 34, 6, 'ascii');
    hdr.write('100644  ', 40, 8, 'ascii');
    hdr.write(m.data.length.toString().padEnd(10, ' '), 48, 10, 'ascii');
    hdr[58] = 0x60; // '`'
    hdr[59] = 0x0a; // '\n'
    chunks.push(hdr);
    chunks.push(m.data);
    if (m.data.length % 2 !== 0) {
      chunks.push(Buffer.from('\n', 'ascii'));
    }
  }
  return Buffer.concat(chunks);
}

function buildIpk() {
  const appDir = __dirname;
  const appInfoPath = path.join(appDir, 'appinfo.json');
  if (!fs.existsSync(appInfoPath)) {
    console.error('Errore: appinfo.json non trovato in ' + appDir);
    process.exit(1);
  }

  const appInfo = JSON.parse(fs.readFileSync(appInfoPath, 'utf8'));
  const appId = appInfo.id || 'com.iosonofra.tv';
  const appVer = appInfo.version || '1.0.0';

  console.log(`[iosonofratv] Avvio creazione pacchetto IPK per ${appId} (v${appVer})...`);

  // 1. debian-binary
  const debianBinary = Buffer.from('2.0\n', 'ascii');

  // 2. control.tar.gz
  const controlContent = [
    `Package: ${appId}`,
    `Version: ${appVer}`,
    'Section: misc',
    'Priority: optional',
    'Architecture: all',
    'Maintainer: iosonofra',
    'Description: iosonofratv Client for LG webOS Smart TV',
    ''
  ].join('\n');

  const controlTar = makeTar([
    { name: './', isDir: true },
    { name: './control', data: Buffer.from(controlContent, 'utf-8') }
  ]);
  const controlTarGz = zlib.gzipSync(controlTar);

  // 3. data.tar.gz
  const filesToPackage = ['appinfo.json', 'index.html', 'icon.png', 'largeIcon.png', 'background.png'];
  const basePath = `./usr/palm/applications/${appId}`;

  const dataFileList = [
    { name: './', isDir: true },
    { name: './usr/', isDir: true },
    { name: './usr/palm/', isDir: true },
    { name: './usr/palm/applications/', isDir: true },
    { name: `${basePath}/`, isDir: true }
  ];

  for (const fn of filesToPackage) {
    const p = path.join(appDir, fn);
    if (fs.existsSync(p)) {
      dataFileList.push({
        name: `${basePath}/${fn}`,
        data: fs.readFileSync(p)
      });
      console.log(`  -> Aggiunto: ${fn}`);
    }
  }

  const dataTar = makeTar(dataFileList);
  const dataTarGz = zlib.gzipSync(dataTar);

  // 4. Assemblaggio Archivio AR (.ipk)
  const ipkBuffer = makeArArchive([
    { name: 'debian-binary', data: debianBinary },
    { name: 'control.tar.gz', data: controlTarGz },
    { name: 'data.tar.gz', data: dataTarGz }
  ]);

  const outputName = `${appId}_${appVer}_all.ipk`;
  const outputPath = path.join(appDir, outputName);
  fs.writeFileSync(outputPath, ipkBuffer);

  console.log('=======================================================');
  console.log(`✅ PACCHETTO IPK CREATO CON SUCCESSO!`);
  console.log(`📦 File: ${outputName}`);
  console.log(`📂 Percorso: ${outputPath}`);
  console.log(`📊 Dimensione: ${(ipkBuffer.length / 1024).toFixed(1)} KB`);
  console.log('=======================================================');
  console.log('Puoi installare questo file sulla tua TV LG trascinandolo');
  console.log('direttamente nella finestra di "webOS Dev Manager"!');
}

if (require.main === module) {
  buildIpk();
}

module.exports = { buildIpk };
