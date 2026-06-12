/**
 * roomManager.js
 * Manages all room lifecycle: create, join, leave, ready state.
 *
 * Room data structure:
 * {
 *   id: string,
 *   players: [
 *     { socketId, nickname, isReady, playerIndex (1|2) }
 *   ],
 *   status: 'waiting' | 'ready' | 'playing' | 'finished',
 *   createdAt: Date,
 * }
 */

const { nanoid } = require("nanoid");

/** @type {Map<string, Room>} roomId → Room */
const rooms = new Map();

/** @type {Map<string, string>} socketId → roomId */
const socketToRoom = new Map();

/**
 * Generate a short, human-readable room code (e.g. "AB12CD")
 */
function generateRoomId() {
  return nanoid(6).toUpperCase();
}

/**
 * Creates a new room and adds the creator as Player 1.
 * @returns {{ success: boolean, room?: Room, error?: string }}
 */
function createRoom(socketId, nickname) {
  // Remove from any existing room first
  leaveRoom(socketId);

  const roomId = generateRoomId();
  const room = {
    id: roomId,
    players: [
      {
        socketId,
        nickname: nickname || `Player${Math.floor(Math.random() * 1000)}`,
        isReady: false,
        playerIndex: 1,
      },
    ],
    status: "waiting",
    createdAt: new Date(),
  };

  rooms.set(roomId, room);
  socketToRoom.set(socketId, roomId);

  console.log(`[Room] Created: ${roomId} by ${nickname} (${socketId})`);
  return { success: true, room };
}

/**
 * Joins an existing room as Player 2.
 * @returns {{ success: boolean, room?: Room, error?: string }}
 */
function joinRoom(socketId, nickname, roomId) {
  const room = rooms.get(roomId);

  if (!room) {
    return { success: false, error: "Room not found." };
  }
  if (room.players.length >= 2) {
    return { success: false, error: "Room is full." };
  }
  if (room.status === "playing") {
    return { success: false, error: "Game already in progress." };
  }

  // Remove from any existing room first
  leaveRoom(socketId);

  room.players.push({
    socketId,
    nickname: nickname || `Player${Math.floor(Math.random() * 1000)}`,
    isReady: false,
    playerIndex: 2,
  });

  socketToRoom.set(socketId, roomId);

  console.log(`[Room] ${nickname} (${socketId}) joined room ${roomId}`);
  return { success: true, room };
}

/**
 * Removes a socket from their current room.
 * Deletes the room if it's now empty.
 * @returns {{ roomId?: string, room?: Room, wasHost: boolean }}
 */
function leaveRoom(socketId) {
  const roomId = socketToRoom.get(socketId);
  if (!roomId) return { wasHost: false };

  const room = rooms.get(roomId);
  if (!room) {
    socketToRoom.delete(socketId);
    return { wasHost: false };
  }

  const playerIdx = room.players.findIndex((p) => p.socketId === socketId);
  const wasHost = playerIdx === 0; // Player 1 is the host
  room.players.splice(playerIdx, 1);
  socketToRoom.delete(socketId);

  if (room.players.length === 0) {
    rooms.delete(roomId);
    console.log(`[Room] Deleted empty room ${roomId}`);
  } else {
    // Re-index remaining player as Player 1
    room.players[0].playerIndex = 1;
    room.players[0].isReady = false;
    room.status = "waiting";
    console.log(`[Room] Player left ${roomId}, ${room.players.length} remaining`);
  }

  return { roomId, room: rooms.get(roomId), wasHost };
}

/**
 * Toggles the ready state for a player.
 * Returns whether both players are now ready.
 */
function setPlayerReady(socketId, isReady) {
  const roomId = socketToRoom.get(socketId);
  if (!roomId) return { success: false, error: "Not in a room." };

  const room = rooms.get(roomId);
  if (!room) return { success: false, error: "Room not found." };

  const player = room.players.find((p) => p.socketId === socketId);
  if (!player) return { success: false, error: "Player not in room." };

  player.isReady = isReady;

  const allReady =
    room.players.length === 2 && room.players.every((p) => p.isReady);

  if (allReady) {
    room.status = "ready";
  }

  console.log(
    `[Room] ${player.nickname} ready=${isReady} in room ${roomId}. allReady=${allReady}`
  );
  return { success: true, room, allReady };
}

/**
 * Marks a room as 'playing'.
 */
function startGame(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    room.status = "playing";
  }
}

/**
 * Marks a room as 'finished'.
 */
function finishGame(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    room.status = "finished";
  }
}

/**
 * Gets the room for a given socket.
 */
function getRoomBySocket(socketId) {
  const roomId = socketToRoom.get(socketId);
  return roomId ? rooms.get(roomId) : null;
}

/**
 * Gets a room by its ID.
 */
function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

/**
 * Returns a sanitized (client-safe) room object.
 */
function sanitizeRoom(room) {
  return {
    id: room.id,
    status: room.status,
    players: room.players.map((p) => ({
      nickname: p.nickname,
      playerIndex: p.playerIndex,
      isReady: p.isReady,
    })),
  };
}

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  setPlayerReady,
  startGame,
  finishGame,
  getRoomBySocket,
  getRoom,
  sanitizeRoom,
};
