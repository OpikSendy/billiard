/**
 * server.js
 * Entry point for the 9-Ball Pool backend.
 * Express + Socket.io server.
 *
 * ─── Socket Event Contract ────────────────────────────────
 *
 * CLIENT → SERVER:
 *   create_room   { nickname }
 *   join_room     { nickname, roomId }
 *   player_ready  { isReady }
 *   shoot         { angle, power, cueBallPos: { x, y } }
 *   sync_result   { positions: BallPos[], foulData: FoulData }
 *   leave_room    (no payload)
 *
 * SERVER → CLIENT:
 *   room_created      { room }
 *   room_joined       { room }
 *   room_updated      { room }                ← player list changes
 *   room_error        { message }
 *   game_start        { gameState, yourIndex } ← both players ready
 *   opponent_shot     { angle, power, cueBallPos, shooterIndex }
 *   turn_result       { gameState, turnResult, authPositions, desynced }
 *   game_over         { winner, gameState }
 *   opponent_left     { message }
 * ──────────────────────────────────────────────────────────
 */

require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const roomManager = require("./roomManager");
const gameManager = require("./gameManager");
const { validateSync } = require("./syncValidator");

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";

// ─── Express Setup ────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Room info (debug)
app.get("/room/:roomId", (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(roomManager.sanitizeRoom(room));
});

// ─── Socket.io Setup ─────────────────────────────────────────────────────────

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ─── Socket Event Handlers ───────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ── CREATE ROOM ──────────────────────────────────────────────────────────
  socket.on("create_room", ({ nickname } = {}) => {
    const result = roomManager.createRoom(socket.id, nickname);

    if (!result.success) {
      return socket.emit("room_error", { message: result.error });
    }

    socket.join(result.room.id);
    socket.emit("room_created", {
      room: roomManager.sanitizeRoom(result.room),
    });

    console.log(`[Socket] ${nickname} created room ${result.room.id}`);
  });

  // ── JOIN ROOM ────────────────────────────────────────────────────────────
  socket.on("join_room", ({ nickname, roomId } = {}) => {
    if (!roomId) {
      return socket.emit("room_error", { message: "Room ID is required." });
    }

    const result = roomManager.joinRoom(socket.id, nickname, roomId.toUpperCase());

    if (!result.success) {
      return socket.emit("room_error", { message: result.error });
    }

    socket.join(result.room.id);

    // Notify joining player
    socket.emit("room_joined", {
      room: roomManager.sanitizeRoom(result.room),
    });

    // Notify all players in the room (including the creator)
    io.to(result.room.id).emit("room_updated", {
      room: roomManager.sanitizeRoom(result.room),
    });

    console.log(`[Socket] ${nickname} joined room ${result.room.id}`);
  });

  // ── PLAYER READY ─────────────────────────────────────────────────────────
  socket.on("player_ready", ({ isReady } = {}) => {
    const result = roomManager.setPlayerReady(socket.id, isReady !== false);

    if (!result.success) {
      return socket.emit("room_error", { message: result.error });
    }

    // Broadcast updated room to all players
    io.to(result.room.id).emit("room_updated", {
      room: roomManager.sanitizeRoom(result.room),
    });

    // If all players ready → start the game!
    if (result.allReady) {
      startGame(result.room);
    }
  });

  // ── SHOOT ────────────────────────────────────────────────────────────────
  socket.on("shoot", ({ angle, power, cueBallPos } = {}) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.status !== "playing") return;

    const result = gameManager.recordShot(room.id, socket.id, {
      angle,
      power,
      cueBallPos,
    });

    if (!result.success) {
      return socket.emit("room_error", { message: result.error });
    }

    // Broadcast shot to ALL players in the room (including shooter, for confirmation)
    io.to(room.id).emit("opponent_shot", {
      angle,
      power,
      cueBallPos,
      shooterIndex: result.shot.shooterIndex,
    });

    console.log(`[Socket] Shot broadcast to room ${room.id}`);
  });

  // ── SYNC RESULT ──────────────────────────────────────────────────────────
  socket.on("sync_result", ({ positions, foulData } = {}) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.status !== "playing") return;

    const result = gameManager.recordSyncResult(room.id, socket.id, {
      positions,
      foulData,
    });

    if (!result.success) return;

    if (!result.ready) {
      // Waiting for the other client
      console.log(`[Socket] Room ${room.id}: waiting for other client sync`);
      return;
    }

    // Both clients submitted — validate and apply turn
    const { authoritative, desynced, deviation } = validateSync(result.allResults);
    const { foulData: authFoulData, positions: authPositions } = authoritative;

    const gameState = gameManager.getGameState(room.id);
    const isPushOutActive = gameState?.isPushOutActive || false;

    // Build turn result from authoritative foul data
    const turnResult = buildTurnResult(authFoulData, authPositions, isPushOutActive);

    // Determine winner nickname if ball 9 was pocketed legally OR if 3-foul rule triggered
    let winnerNickname = null;
    let authFoul = authFoulData?.foul || turnResult.foul;

    if (gameState) {
      // Check if this new foul triggers 3-foul forfeit
      if (authFoul) {
        const currentFouls = (gameState.consecutiveFouls[gameState.currentPlayerIndex] || 0) + 1;
        if (currentFouls >= 3) {
          turnResult.won = true;
          turnResult.foul = "three_fouls";
          
          // Winner is the OTHER player!
          const opponentIndex = gameState.currentPlayerIndex === 1 ? 2 : 1;
          const opponent = gameState.players.find((p) => p.playerIndex === opponentIndex);
          winnerNickname = opponent?.nickname || `Player ${opponentIndex}`;
        }
      }
    }

    if (turnResult.won && !winnerNickname && gameState) {
      const winner = gameState.players.find(
        (p) => p.playerIndex === gameState.currentPlayerIndex
      );
      winnerNickname = winner?.nickname || `Player ${gameState.currentPlayerIndex}`;
    }

    // Apply turn result to game state
    const updatedState = gameManager.applyTurnResult(
      room.id,
      turnResult,
      winnerNickname
    );

    const safeState = gameManager.sanitizeGameState(updatedState);

    if (turnResult.won) {
      // Game over!
      roomManager.finishGame(room.id);
      io.to(room.id).emit("game_over", {
        winner: winnerNickname,
        gameState: safeState,
      });
      console.log(`[Socket] Game over in room ${room.id} - winner: ${winnerNickname}`);
    } else {
      // Continue game
      io.to(room.id).emit("turn_result", {
        gameState: safeState,
        turnResult,
        authPositions,
        desynced,
        deviation: deviation.toFixed(2),
      });
    }
  });

  // ── DECLARE PUSH OUT ─────────────────────────────────────────────────────
  socket.on("declare_push_out", () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.status !== "playing") return;

    const state = gameManager.getGameState(room.id);
    if (!state) return;

    const shooter = room.players.find((p) => p.socketId === socket.id);
    if (!shooter || shooter.playerIndex !== state.currentPlayerIndex) return;

    if (state.pushOutAvailable) {
      state.isPushOutActive = true;
      io.to(room.id).emit("push_out_declared", {
        gameState: gameManager.sanitizeGameState(state)
      });
      console.log(`[Socket] Room ${room.id}: player ${shooter.playerIndex} declared Push Out`);
    }
  });

  // ── RESOLVE PUSH OUT ─────────────────────────────────────────────────────
  socket.on("resolve_push_out", ({ accept } = {}) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.status !== "playing") return;

    const state = gameManager.getGameState(room.id);
    if (!state || !state.pushOutResolvePending) return;

    const resolver = room.players.find((p) => p.socketId === socket.id);
    if (!resolver || resolver.playerIndex !== state.currentPlayerIndex) return;

    state.pushOutResolvePending = false;

    if (!accept) {
      // Pass back: currentPlayerIndex flips back to the original shooter
      state.currentPlayerIndex = state.currentPlayerIndex === 1 ? 2 : 1;
      console.log(`[Socket] Room ${room.id}: player ${resolver.playerIndex} passed back turn`);
    } else {
      console.log(`[Socket] Room ${room.id}: player ${resolver.playerIndex} accepted turn`);
    }

    io.to(room.id).emit("push_out_resolved", {
      gameState: gameManager.sanitizeGameState(state)
    });
  });

  // ── LEAVE ROOM ───────────────────────────────────────────────────────────
  socket.on("leave_room", () => {
    handlePlayerLeave(socket);
  });

  // ── DISCONNECT ───────────────────────────────────────────────────────────
  socket.on("disconnect", (reason) => {
    console.log(`[Socket] Disconnected: ${socket.id} (${reason})`);
    handlePlayerLeave(socket);
  });
});

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Starts the game for a room — initializes game state and notifies clients.
 */
function startGame(room) {
  roomManager.startGame(room.id);

  const gameState = gameManager.initGame(room.id, room.players);
  const safeState = gameManager.sanitizeGameState(gameState);

  // Notify each player individually with their index
  room.players.forEach((player) => {
    io.to(player.socketId).emit("game_start", {
      gameState: safeState,
      yourIndex: player.playerIndex,
    });
  });

  console.log(`[Socket] Game started in room ${room.id}`);
}

/**
 * Handles a player leaving or disconnecting.
 */
function handlePlayerLeave(socket) {
  const { roomId, room, wasHost } = roomManager.leaveRoom(socket.id);

  if (!roomId) return;

  socket.leave(roomId);

  if (room) {
    // Someone is still in the room
    io.to(roomId).emit("opponent_left", {
      message: "Your opponent has left the game.",
    });
    io.to(roomId).emit("room_updated", {
      room: roomManager.sanitizeRoom(room),
    });
  }

  // Cleanup game state
  gameManager.destroyGame(roomId);
}

/**
 * Builds a TurnResult object from authoritative foul and position data.
 * (Mirrors the frontend rules logic, but server-authoritative.)
 */
function buildTurnResult(foulData, positions, isPushOutActive = false) {
  if (!foulData) {
    return {
      foul: null,
      ballsPocketed: [],
      won: false,
      switchTurn: true,
    };
  }

  const {
    cueBallPocketed,
    firstHitBall,
    railContactMade,
    pocketedThisTurn,
    foul: existingFoul,
  } = foulData;

  const activeBalls = positions.filter((p) => !p.isPocketed && p.number > 0);
  const lowestRemaining =
    activeBalls.length > 0 ? Math.min(...activeBalls.map((b) => b.number)) : null;

  const lowestBeforeTurn = pocketedThisTurn.length === 0
    ? lowestRemaining
    : Math.min(...[...activeBalls, ...pocketedThisTurn.map((n) => ({ number: n }))].map((b) => b.number));

  // Scratch is ALWAYS a foul, even in Push Out!
  if (cueBallPocketed) {
    return { foul: "scratch", ballsPocketed: pocketedThisTurn, won: false, switchTurn: true };
  }

  if (isPushOutActive) {
    // Push Out: ignore wrong ball and no cushion contact!
    // giliran switches but no foul is assessed, and opponent has the option to pass it back
    return {
      foul: null,
      ballsPocketed: pocketedThisTurn,
      won: false,
      switchTurn: true,
      isPushOutResolve: true,
    };
  }

  // Normal foul checks
  if (firstHitBall === null || (lowestBeforeTurn !== null && firstHitBall !== lowestBeforeTurn)) {
    return { foul: "wrong_ball", ballsPocketed: pocketedThisTurn, won: false, switchTurn: true };
  }

  if (!railContactMade) {
    return { foul: "no_rail_contact", ballsPocketed: pocketedThisTurn, won: false, switchTurn: true };
  }

  // Win condition: ball 9 pocketed legally
  if (pocketedThisTurn.includes(9)) {
    return { foul: null, ballsPocketed: pocketedThisTurn, won: true, switchTurn: false };
  }

  // Normal result
  const keepTurn = pocketedThisTurn.length > 0;
  return {
    foul: null,
    ballsPocketed: pocketedThisTurn,
    won: false,
    switchTurn: !keepTurn,
  };
}

// ─── Start Server ─────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║  🎱  9-Ball Pool Server              ║
║  Port     : ${PORT}                    ║
║  CORS     : ${CLIENT_ORIGIN}   ║
║  Status   : RUNNING ✓               ║
╚══════════════════════════════════════╝
  `);
});

module.exports = { app, io };
