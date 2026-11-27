"""Capture the selected room's recent finished matches, or replay a private baseline."""

import argparse
import collections
import getpass
import json
import os
import secrets
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener


SOURCE = "https://football-app.tarotoracle.workers.dev"
PREVIEW = "https://football-preview.atsyg-feedme.workers.dev"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def api(origin, path, body=None, token=None):
    headers = {"Content-Type": "application/json", "User-Agent": "Football-Clubhouse-Preview/1.0"}
    if token:
        headers["x-fc26-room-session"] = token
    request = Request(origin + "/api/" + path, headers=headers,
                      data=json.dumps(body).encode() if body is not None else None)
    try:
        with build_opener(NoRedirect).open(request, timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        raise RuntimeError(f"Room API returned HTTP {error.code} for {path.split('/')[-1]}") from None


def capture(room):
    pin = os.getenv("CLUBHOUSE_SOURCE_PIN") or getpass.getpass("Source room PIN: ")
    source = api(SOURCE, "rooms/" + quote(room, safe="") + "/sessions", {"pin": pin, "identifier": room})
    if source["room"]["name"].casefold() != room.casefold():
        raise ValueError("Source room mismatch")
    path = "rooms/" + quote(source["room"]["id"], safe="") + "/"
    token = source["session"]["token"]
    matches = api(SOURCE, path + "match-history?scope=all", token=token)["matches"]
    books = api(SOURCE, path + "bet-history", token=token)["games"]
    settled = {book["gameId"]: book.get("settled", []) for book in books}
    roster = source["gamers"]
    aliases = {gamer["id"]: index for index, gamer in enumerate(roster)}
    games = []
    for match in reversed(matches):
        sides = {side: [aliases[player] for player in match[side]["gamerIds"]] for side in ("home", "away")}
        result = match["result"]
        positions = []
        for bet in settled.get(match["gameId"], []):
            if bet["outcome"] not in ("home", "away", "draw"):
                raise ValueError("Unsupported outcome")
            positions.append([aliases[bet["gamerId"]], bet["outcome"], int(bet["stake"]), int(bet["payout"])])
        if result not in ("home", "away", "draw"):
            raise ValueError("Unsupported result")
        scores = [None if match[side]["score"] is None else int(match[side]["score"]) for side in ("home", "away")]
        games.append(dict(**sides, result=result, scores=scores, bets=positions))
    return {"version": 1, "ratings": [int(gamer["rating"]) for gamer in roster], "games": games}


def private_output(path):
    path = Path(path).resolve()
    if path.is_relative_to(Path(__file__).resolve().parents[1]) or not path.parent.is_dir() or path.exists():
        raise ValueError("Choose an unused private output path outside the checkout")
    return path


def save_private(path, data):
    path = private_output(path)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(data, output)


def restore(baseline, name, access):
    private_output(access)
    if baseline.get("version") != 1:
        raise ValueError("Unsupported baseline version")
    pin = f"{secrets.randbelow(10000):04d}"
    room = api(PREVIEW, "rooms", {"name": name, "pin": pin})
    base = "rooms/" + quote(room["room"]["id"], safe="") + "/"
    save_private(access, dict(room=name, pin=pin))
    token = room["session"]["token"]
    def post(path, body):
        return api(PREVIEW, base + path, body, token)
    gamers = []
    for index, rating in enumerate(baseline["ratings"], start=1):
        response = post("gamers", {"name": f"Player {index:02}", "rating": rating})
        gamers.append(response["gamer"]["id"])
    night = post("game-nights", {"activeGamerIds": gamers, "buyIn": 0})
    path = "game-nights/" + night["gameNight"]["id"] + "/games"
    expected = collections.Counter()
    for game in baseline["games"]:
        active = post(path, {"allocationMode": "manual", "homeGamerIds": [gamers[idx] for idx in game["home"]],
                             "awayGamerIds": [gamers[idx] for idx in game["away"]]})
        current = path + "/" + active["currentGame"]["id"]
        for index, outcome, stake, payout in game["bets"]:
            post(current + "/bets", {"gamerId": gamers[index], "outcome": outcome, "stake": stake})
            expected[gamers[index]] += payout - stake
        post(current + "/result", {"result": game["result"], "homeScore": game["scores"][0], "awayScore": game["scores"][1]})
    matches = api(PREVIEW, base + "match-history?scope=all", token=token)["matches"]
    ledger = api(PREVIEW, base + "chips-ledger", token=token)["entries"]
    if len(matches) != len(baseline["games"]) or any(row["net"] != expected[row["gamerId"]] for row in ledger):
        raise RuntimeError("Preview history or ledger differs from the selected baseline")
    for match, original in zip(reversed(matches), baseline["games"]):
        if match["result"] != original["result"] or [match[side]["score"] for side in ("home", "away")] != original["scores"]:
            raise RuntimeError("Restored score differs from source")
        for side in ("home", "away"):
            if set(match[side]["gamerIds"]) != {gamers[index] for index in original[side]}:
                raise RuntimeError("Restored team differs from source")
    print(f"Verified {len(gamers)} aliases, {len(matches)} matches and selected-game ledger.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    capture_args = commands.add_parser("capture")
    capture_args.add_argument("room")
    capture_args.add_argument("output")
    restore_args = commands.add_parser("restore")
    restore_args.add_argument("baseline")
    restore_args.add_argument("new_room")
    restore_args.add_argument("access_file")
    args = parser.parse_args()
    if args.command == "capture":
        save_private(args.output, capture(args.room))
    else:
        restore(json.loads(Path(args.baseline).read_text()), args.new_room, args.access_file)
