# CCN-Project

> A concise demonstration of reliable UDP communication with C clients/servers and a lightweight Electron UI.

## Overview

This repository contains a small project that demonstrates reliable message exchange over UDP. It includes:

- Native C implementations of a server and client (cross-platform, with Windows variants).
- A simple Electron-based UI to interact with the UDP client on Windows.

The code is suitable for learning, demos, or as a starting point for more advanced experiments in reliable UDP protocols.

## Features

- Basic reliable messaging patterns on top of UDP.
- Cross-platform C code with Windows-specific builds (`*_win.c`).
- Electron UI in `ui_electron/` for quick interaction and visualization.

## Repo structure (key files)

- `server/` - server implementations and Makefile
- `client/` - client implementations and Makefile
- `ui_electron/` - Electron UI (Node/Electron app)
- `README.md` - this file

## Prerequisites

- GCC (or another C compiler)
- Node.js and npm (for the Electron UI)
- On Windows builds using sockets: link against `ws2_32` (winsock)

## Build & Run (Windows - cmd.exe)

Build the server (example using gcc):

```
gcc -o server\\server_win.exe server\\server_win.c -lws2_32
```

Run the server (listening port 5001):

```
server\\server_win.exe 5001
```

Build and run the client (example):

```
gcc -o client\\client_win.exe client\\client_win.c -lws2_32
client\\client_win.exe 127.0.0.1 5001
```

## Build & Run (Unix-like)

Use the included Makefiles where available:

```
make -C server
./server/server 5001

make -C client
./client/client 127.0.0.1 5001
```

## Electron UI

To run the UI (in `ui_electron/`):

```
cd ui_electron
npm install
npm start
```

The UI is a convenience for interacting with the UDP client on supported platforms.

## Contributing

Small, focused contributions are welcome. Open an issue or submit a pull request with a short description of the change.

## License

No license file is included in this repository. If you want to publish this project, consider adding an appropriate license (for example, MIT).

## Issues & Contact

Use the repository Issues page for bug reports or feature requests.

---

Short and focused — if you'd like, I can expand sections (detailed protocol notes, examples, or a short quickstart script).
