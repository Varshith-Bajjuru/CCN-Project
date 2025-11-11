const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

// Windows server uses C long as 4 bytes (little-endian)
function writeInt(buf, value, offset) { buf.writeInt32LE(value, offset); }
function readInt(buf, offset) { return buf.readInt32LE(offset); }

class UdpClientWin {
  constructor(host, port, logCb) {
    this.host = host;
    this.port = port;
    this.sock = dgram.createSocket('udp4');
    this.log = logCb || (() => {});
    this.metricsCb = null; // optional metrics callback
  }

  close() {
    try { this.sock.close(); } catch (_) {}
  }

  sendCommandString(cmdStr, size = 50) {
    const buf = Buffer.alloc(size);
    buf.write(cmdStr, 0, Math.min(size, Buffer.byteLength(cmdStr)));
    return new Promise((resolve, reject) => {
      this.sock.send(buf, this.port, this.host, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  recvOnce(expectedLen, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const onMsg = (msg) => {
        cleanup();
        resolve(msg);
      };
      const onErr = (err) => { cleanup(); reject(err); };
      const cleanup = () => {
        clearTimeout(timer);
        this.sock.removeListener('message', onMsg);
        this.sock.removeListener('error', onErr);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for UDP response'));
      }, timeoutMs);
      this.sock.once('message', onMsg);
      this.sock.once('error', onErr);
    });
  }

  async list() {
    await this.sendCommandString('ls');
    const msg = await this.recvOnce();
    const text = msg.toString('utf8');
    this.log(`[ls] received ${msg.length} bytes`);
    return { ok: true, entries: text.split(/\r?\n/).filter(Boolean) };
  }

  async delete(filename) {
    await this.sendCommandString(`delete ${filename}`);
    const msg = await this.recvOnce(4);
    const code = readInt(msg, 0);
    this.log(`[delete] code=${code}`);
    if (code > 0) return { ok: true };
    if (code < 0) return { ok: false, error: 'Invalid file name' };
    return { ok: false, error: 'Permission denied' };
  }

  async get(filename, saveToPath) {
    await this.sendCommandString(`get ${filename}`);
    // Receive total_frame (int32)
    let totalBuf;
    try {
      totalBuf = await this.recvOnce(4, 2000);
    } catch (e) {
      return { ok: false, error: 'Server not responding or file absent' };
    }
    const total = readInt(totalBuf, 0);
    this.log(`[get] total frames: ${total}`);
    if (total <= 0) return { ok: false, error: 'File empty or not found' };

    // Ack total back
    const ackBuf = Buffer.alloc(4); writeInt(ackBuf, total, 0);
    await new Promise((resolve, reject) => this.sock.send(ackBuf, this.port, this.host, (err) => err ? reject(err) : resolve()));

  const fd = fs.openSync(saveToPath, 'w');
    let expectedId = 1;
    let bytes = 0;

    while (expectedId <= total) {
      const frame = await this.recvOnce(2056, 5000);
      const id = readInt(frame, 0);
      const len = readInt(frame, 4);
      const data = frame.subarray(8, 8 + len);

      // Ack back the received id
      const ack = Buffer.alloc(4); writeInt(ack, id, 0);
      await new Promise((resolve, reject) => this.sock.send(ack, this.port, this.host, (err) => err ? reject(err) : resolve()));

      if (id === expectedId) {
        fs.writeSync(fd, data);
        bytes += len;
        this.log(`[get] frame ${id}/${total}, len=${len}, totalBytes=${bytes}`);
        if (this.metricsCb) this.metricsCb({ type: 'get', id, total, len, bytesTotal: bytes, ts: Date.now() });
        expectedId++;
      } else {
        this.log(`[get] out-of-order frame id=${id}, expected=${expectedId}; will retry`);
      }
    }

    fs.closeSync(fd);
    this.log(`[get] completed: ${bytes} bytes`);
    if (this.metricsCb) this.metricsCb({ type: 'get:done', totalBytes: bytes, totalFrames: total, ts: Date.now() });
    return { ok: true, bytes };
  }

  async put(filePath) {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const total = Math.ceil(fileSize / 2048);
    const baseName = path.basename(filePath);

    await this.sendCommandString(`put ${baseName}`);

    // send total frames
    const totalBuf = Buffer.alloc(4); writeInt(totalBuf, total, 0);
    await new Promise((resolve, reject) => this.sock.send(totalBuf, this.port, this.host, (err) => err ? reject(err) : resolve()));

    // expect ack equal to total
    let ackBuf;
    try {
      ackBuf = await this.recvOnce(4, 2000);
    } catch (e) {
      return { ok: false, error: 'No ACK for total frames' };
    }
    let ack = readInt(ackBuf, 0);
    if (ack !== total) {
      // retry few times
      let retries = 0, ok = false;
      while (retries < 20 && !ok) {
        await new Promise((resolve, reject) => this.sock.send(totalBuf, this.port, this.host, (err) => err ? reject(err) : resolve()));
        try {
          ackBuf = await this.recvOnce(4, 2000);
          ack = readInt(ackBuf, 0);
          if (ack === total) ok = true;
        } catch (_) {}
        retries++;
      }
      if (!ok) return { ok: false, error: 'ACK mismatch for total frames' };
    }

    // Send frames
    const fd = fs.openSync(filePath, 'r');
    let sent = 0;
    for (let i = 1; i <= total; i++) {
      const chunk = Buffer.alloc(Math.min(2048, fileSize - sent));
      const read = fs.readSync(fd, chunk, 0, chunk.length, sent);
      sent += read;

      const frame = Buffer.alloc(8 + 2048); // send fixed-size like C struct
      writeInt(frame, i, 0);
      writeInt(frame, read, 4);
      chunk.copy(frame, 8);

      let tries = 0; let ackOk = false;
      while (tries < 200 && !ackOk) {
        await new Promise((resolve, reject) => this.sock.send(frame, this.port, this.host, (err) => err ? reject(err) : resolve()));
        try {
          const ackBuf2 = await this.recvOnce(4, 2000);
          const idAck = readInt(ackBuf2, 0);
          if (idAck === i) {
            ackOk = true;
            this.log(`[put] frame ${i}/${total}, len=${read}`);
            if (this.metricsCb) this.metricsCb({ type: 'put', id: i, total, len: read, bytesTotal: sent, ts: Date.now() });
          } else {
            tries++;
          }
        } catch (_) {
          tries++;
        }
      }
      if (!ackOk) {
        fs.closeSync(fd);
        return { ok: false, error: `Failed sending frame ${i}` };
      }
    }
    fs.closeSync(fd);
    this.log(`[put] completed: ${fileSize} bytes in ${total} frames`);
    if (this.metricsCb) this.metricsCb({ type: 'put:done', totalBytes: fileSize, totalFrames: total, ts: Date.now() });
    return { ok: true, bytes: fileSize };
  }

  async exit() {
    await this.sendCommandString('exit');
    return { ok: true };
  }

  setMetricsCb(cb) {
    this.metricsCb = cb;
  }

  async ping() {
    const t0 = Date.now();
    try {
      await this.list();
    } catch (e) {
      // even on error, measure time until failure
    }
    const t1 = Date.now();
    return { ok: true, rttMs: t1 - t0 };
  }
}

module.exports = UdpClientWin;
