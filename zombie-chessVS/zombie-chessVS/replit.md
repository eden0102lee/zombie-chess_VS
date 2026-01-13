# Zombie Chess Online

## Overview

Zombie Chess Online is a real-time multiplayer chess variant game built with Node.js. The application enables two players to connect to shared game rooms and play against each other with live updates. The game uses WebSocket technology for real-time bidirectional communication between the server and connected clients.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Server Architecture
- **Runtime**: Node.js with Express.js as the web framework
- **Real-time Communication**: Socket.IO for WebSocket-based bidirectional event-driven communication
- **Static File Serving**: Express serves static files (HTML, CSS, JS) from a `public` directory

### Game State Management
- **Room-based Architecture**: Games are organized into rooms, each supporting exactly 2 players
- **In-memory State**: Game state (board, scores, supply areas, current turn) is stored in a server-side `rooms` object
- **Player Assignment**: Players are automatically assigned numbers (1 or 2) upon joining a room

### Client-Server Communication Pattern
- **Event-driven**: Uses Socket.IO events for all game actions
- **Key Events**:
  - `joinRoom`: Player requests to join a specific room
  - `playerAssigned`: Server confirms player number assignment
  - `gameStart`: Broadcast when both players have joined
  - `errorMsg`: Error notifications (e.g., room full)

### Frontend Architecture
- Static HTML/CSS/JS served from the `public` directory (not yet created)
- Client-side Socket.IO for real-time server communication

## External Dependencies

### NPM Packages
| Package | Purpose |
|---------|---------|
| express | Web server framework for HTTP handling and static file serving |
| socket.io | Real-time WebSocket communication library |

### Infrastructure Requirements
- No database required - game state is ephemeral and stored in memory
- No external APIs or third-party services
- Single server deployment model