"""
app.py — Elite UNO Multiplayer Server
Flask + Flask-SocketIO | Supports: Normal | Flip | No Mercy
Author: Peak Dev Build
"""

import os
import logging
import string
import random
from threading import Lock
from flask import (
    Flask, render_template, request,
    session, redirect, url_for, jsonify
)
from flask_socketio import SocketIO, join_room, leave_room, emit

from game_logic import create_game, UnoBaseGame

# ─────────────────────────────────────────────
#  App Configuration
# ─────────────────────────────────────────────

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", "uno-elite-secret-change-in-prod"),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)

def _detect_async_mode() -> str:
    """Pick the best available async backend automatically."""
    try:
        import eventlet          # noqa: F401
        return "eventlet"
    except ImportError:
        pass
    try:
        import gevent            # noqa: F401
        return "gevent"
    except ImportError:
        pass
    return "threading"           # always available, no extra install needed

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode=_detect_async_mode(),
    logger=False,
    engineio_logger=False,
)

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("uno")

# ─────────────────────────────────────────────
#  In-Memory Store
# ─────────────────────────────────────────────

# { room_code: UnoBaseGame }
active_games: dict[str, UnoBaseGame] = {}

# { sid: room_code }  — quick reverse lookup
sid_to_room: dict[str, str] = {}

games_lock = Lock()

MAX_PLAYERS   = 10
MIN_PLAYERS   = 2
ROOM_CODE_LEN = 6
VALID_RULESETS = {"normal", "flip", "nomercy"}


# ─────────────────────────────────────────────
#  Utilities
# ─────────────────────────────────────────────

def generate_room_code(length: int = ROOM_CODE_LEN) -> str:
    chars = string.ascii_uppercase + string.digits
    while True:
        code = "".join(random.choices(chars, k=length))
        if code not in active_games:
            return code


def _emit_state(room: str, game: UnoBaseGame):
    """Broadcast the public game state to all players in a room."""
    socketio.emit("game_update", game.get_state(), to=room)


def _emit_hand(sid: str, game: UnoBaseGame):
    """Send a player their private hand."""
    socketio.emit("your_hand", game.get_hand(sid), to=sid)


def _emit_all_hands(room: str, game: UnoBaseGame):
    """Refresh every player's private hand after game start / draw events."""
    for player in game.players:
        _emit_hand(player.sid, game)


def _resolve_room(sid: str):
    """Return (room_code, game) or (None, None) for a given SID."""
    room = sid_to_room.get(sid)
    if not room:
        return None, None
    game = active_games.get(room)
    return room, game


# ─────────────────────────────────────────────
#  HTTP Routes
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/create_game", methods=["POST"])
def create_game_route():
    ruleset  = request.form.get("ruleset", "normal").strip().lower()
    username = request.form.get("username", "").strip()

    if not username or len(username) > 24:
        return jsonify({"ok": False, "error": "Invalid username."}), 400

    if ruleset not in VALID_RULESETS:
        ruleset = "normal"

    with games_lock:
        room_code = generate_room_code()
        game = create_game(ruleset)
        game.host_username = username          # ← store host identity at creation
        active_games[room_code] = game

    session["username"] = username
    session["room"]     = room_code
    log.info("Room %s created by %s (ruleset=%s)", room_code, username, ruleset)
    return redirect(url_for("game_room", room=room_code))


@app.route("/join_game", methods=["POST"])
def join_game_route():
    room_code = request.form.get("room_code", "").strip().upper()
    username  = request.form.get("username", "").strip()

    if not username or len(username) > 24:
        return jsonify({"ok": False, "error": "Invalid username."}), 400

    if room_code not in active_games:
        return jsonify({"ok": False, "error": "Room not found."}), 404

    game = active_games[room_code]
    if game.started:
        return jsonify({"ok": False, "error": "Game already in progress."}), 409

    if len(game.players) >= MAX_PLAYERS:
        return jsonify({"ok": False, "error": "Room is full."}), 409

    session["username"] = username
    session["room"]     = room_code
    return redirect(url_for("game_room", room=room_code))


@app.route("/game/<room>")
def game_room(room):
    if room not in active_games:
        return redirect(url_for("index"))
    username = session.get("username", "Guest")
    game     = active_games[room]
    # Tell the client immediately if they are host — no socket race condition
    is_host  = getattr(game, "host_username", None) == username
    return render_template("game.html", room=room, username=username, is_host=is_host)


@app.route("/ping")
def ping():
    """Health check — used by UptimeRobot to keep server alive."""
    return "pong", 200


@app.route("/api/rooms/<room>/state")
def room_state(room):
    game = active_games.get(room)
    if not game:
        return jsonify({"ok": False, "error": "Room not found."}), 404
    return jsonify({"ok": True, "state": game.get_state()})


# ─────────────────────────────────────────────
#  WebSocket Events
# ─────────────────────────────────────────────

@socketio.on("connect")
def on_connect():
    log.info("Socket connected: %s", request.sid)


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    room, game = _resolve_room(sid)

    if room and game:
        player = game.get_player_by_sid(sid)
        name   = player.name if player else "Unknown"
        game.remove_player(sid)
        sid_to_room.pop(sid, None)

        emit("player_left", {
            "username": name,
            "msg":      f"{name} has left the game.",
            "players":  [p.to_dict() for p in game.players],
        }, to=room)

        # Clean up empty rooms
        if not game.players:
            with games_lock:
                active_games.pop(room, None)
            log.info("Room %s cleaned up (empty).", room)

    log.info("Socket disconnected: %s", sid)


@socketio.on("join")
def on_join(data: dict):
    username = data.get("username", "").strip()
    room     = data.get("room", "").strip().upper()

    if not username or not room:
        emit("error", {"msg": "Username and room are required."})
        return

    game = active_games.get(room)
    if not game:
        emit("error", {"msg": "Room does not exist."})
        return

    if game.started:
        # Allow reconnect by SID refresh — find player by name
        existing = game.get_player_by_name(username)
        if existing:
            existing.sid = request.sid
            sid_to_room[request.sid] = room
            join_room(room)
            _emit_hand(request.sid, game)
            emit("reconnected", {"msg": f"Welcome back, {username}!", "state": game.get_state()})
            return
        emit("error", {"msg": "Game already in progress."})
        return

    ok = game.add_player(username, request.sid)
    if not ok:
        emit("error", {"msg": "Could not join — room may be full or name taken."})
        return

    sid_to_room[request.sid] = room
    join_room(room)
    log.info("%s joined room %s", username, room)

    emit("player_joined", {
        "username": username,
        "msg":      f"{username} has joined!",
        "players":  [p.to_dict() for p in game.players],
        "host":     getattr(game, "host_username", None),
    }, to=room)


@socketio.on("start_game")
def on_start_game(data: dict):
    sid  = request.sid
    room, game = _resolve_room(sid)

    if not room or not game:
        emit("error", {"msg": "You are not in a room."})
        return

    # Identify caller by their registered player name
    player = game.get_player_by_sid(sid)
    if not player:
        emit("error", {"msg": "You are not in this room."})
        return

    # Host = the username that created the room (stored at creation, never depends on join order)
    host = getattr(game, "host_username", None) or (game.players[0].name if game.players else None)
    if player.name != host:
        emit("error", {"msg": "Only the host can start the game."})
        return

    if len(game.players) < MIN_PLAYERS:
        emit("error", {"msg": f"Need at least {MIN_PLAYERS} players to start."})
        return

    result = game.start_game()
    if not result["ok"]:
        emit("error", {"msg": result.get("error", "Cannot start game.")})
        return

    log.info("Game started in room %s", room)
    _emit_all_hands(room, game)
    state = game.get_state()
    state["host_username"] = getattr(game, "host_username", None)
    socketio.emit("game_started", state, to=room)


@socketio.on("play_card")
def on_play_card(data: dict):
    sid          = request.sid
    card_id      = data.get("card_id", "")
    chosen_color = data.get("chosen_color")   # for wild cards
    room, game   = _resolve_room(sid)

    if not room or not game:
        emit("error", {"msg": "You are not in an active game."})
        return

    result = game.play_card(sid, card_id, chosen_color)

    if not result["ok"]:
        emit("invalid_move", {"msg": result.get("error", "Invalid move.")})
        return

    # Send updated private hands (finished players get an empty hand)
    _emit_all_hands(room, game)

    payload = {"state": result["state"]}

    # ── A player just emptied their hand ──────────────────────────────
    if "finish_event" in result:
        fe = result["finish_event"]
        payload["finish_event"] = fe
        # Always emit player_finished so UI can show rank badge immediately
        socketio.emit("player_finished", {
            "player": fe["player"],
            "rank":   fe["rank"],
            "medal":  fe["medal"],
            "state":  result["state"],
        }, to=room)
        log.info("Room %s — %s finished #%d", room, fe["player"], fe["rank"])

        # If that finish ended the whole game → emit final game_over
        if result.get("game_over"):
            socketio.emit("game_over", {
                "finished_players": game.finished_players,
                "loser":            game.loser,
                "state":            result["state"],
            }, to=room)
            log.info("Room %s — game over. Rankings: %s", room, game.finished_players)
        return

    # ── No Mercy mid-play game_over (elimination cascade) ────────────
    if result.get("game_over"):
        _emit_all_hands(room, game)
        socketio.emit("game_over", {
            "finished_players": game.finished_players,
            "loser":            game.loser,
            "state":            result["state"],
        }, to=room)
        log.info("Room %s — game over via elimination.", room)
        return

    # ── Normal card played ────────────────────────────────────────────
    if "forced_draw"    in result: payload["forced_draw"]    = result["forced_draw"]
    if "flipped_to"     in result: payload["flipped_to"]     = result["flipped_to"]
    if "roulette_victim"in result: payload["roulette_victim"] = result["roulette_victim"]
    if "discarded_all"  in result: payload["discarded_all"]  = result["discarded_all"]

    socketio.emit("card_played", payload, to=room)


@socketio.on("draw_card")
def on_draw_card(_data: dict = None):
    sid        = request.sid
    room, game = _resolve_room(sid)

    if not room or not game:
        emit("error", {"msg": "You are not in an active game."})
        return

    result = game.draw_from_deck(sid)
    if not result["ok"]:
        emit("error", {"msg": result.get("error", "Cannot draw.")})
        return

    _emit_all_hands(room, game)
    socketio.emit("card_drawn", {
        "player": game.get_player_by_sid(sid).name if game.get_player_by_sid(sid) else "?",
        "drawn":  result["drawn"],
        "state":  result["state"],
    }, to=room)


@socketio.on("call_uno")
def on_call_uno(_data: dict = None):
    sid        = request.sid
    room, game = _resolve_room(sid)

    if not room or not game:
        return

    result = game.call_uno(sid)
    if result["ok"]:
        player = game.get_player_by_sid(sid)
        socketio.emit("uno_called", {
            "player": player.name if player else "?",
            "msg":    f"{player.name} called UNO!" if player else "UNO!",
            "state":  game.get_state(),
        }, to=room)


@socketio.on("challenge_uno")
def on_challenge_uno(data: dict):
    sid         = request.sid
    target_name = data.get("target", "")
    room, game  = _resolve_room(sid)

    if not room or not game:
        return

    challenger = game.get_player_by_sid(sid)
    result     = game.challenge_uno(sid, target_name)

    _emit_all_hands(room, game)
    socketio.emit("uno_challenge_result", {
        "challenger": challenger.name if challenger else "?",
        "target":     target_name,
        "caught":     result.get("caught", False),
        "state":      game.get_state(),
    }, to=room)


@socketio.on("chat")
def on_chat(data: dict):
    """Simple in-room chat relay."""
    sid  = request.sid
    room = sid_to_room.get(sid)
    if not room:
        return
    player = active_games.get(room, None)
    name   = "?"
    if player:
        p = active_games[room].get_player_by_sid(sid)
        name = p.name if p else "?"

    msg = str(data.get("msg", "")).strip()[:200]
    if msg:
        socketio.emit("chat_message", {"player": name, "msg": msg}, to=room)


@socketio.on("rematch")
def on_rematch(data: dict):
    """Host requests a rematch — resets game with same players and ruleset."""
    sid        = request.sid
    room, game = _resolve_room(sid)

    if not room or not game:
        return

    player = game.get_player_by_sid(sid)
    host   = getattr(game, "host_username", None) or (game.players[0].name if game.players else None)
    if not player or player.name != host:
        emit("error", {"msg": "Only the host can request a rematch."})
        return

    # Broadcast to all players that rematch is starting
    socketio.emit("rematch_starting", {"countdown": 1}, to=room)

    new_game = create_game(game.RULESET, game.max_players)
    new_game.host_username = getattr(game, "host_username", None)

    # Re-register all existing players — keep their SIDs so they stay in room
    for p in game.players:
        new_game.add_player(p.name, p.sid)

    with games_lock:
        active_games[room] = new_game

    # sid_to_room mapping is still valid — all players already in the socket room
    # No need to re-join the socket room; they never left it

    result = new_game.start_game()
    if result["ok"]:
        _emit_all_hands(room, new_game)
        socketio.emit("game_started", new_game.get_state(), to=room)
        log.info("Rematch started in room %s", room)
    else:
        emit("error", {"msg": "Could not start rematch."})


# ─────────────────────────────────────────────
#  Entry Point
# ─────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    mode = socketio.async_mode
    log.info("Starting UNO server on port %d  (async_mode=%s)", port, mode)
    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=False,          # keep False — reloader conflicts with socket threads
        use_reloader=False,
        allow_unsafe_werkzeug=True,   # needed for threading mode in newer Werkzeug
    )
