import argparse
import asyncio
import json
import sys
from datetime import timezone

from twscrape import API, gather


def configure_stdio():
    """Use UTF-8 for the JSON-lines protocol on every platform.

    Windows otherwise inherits a legacy console encoding (commonly GBK/cp936),
    which cannot encode emoji and many other characters found in X posts.
    """
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="backslashreplace")


def value(obj, *names, default=None):
    for name in names:
        current = getattr(obj, name, None)
        if current is not None:
            return current
    return default


class Collector:
    def __init__(self, db_path: str):
        self.api = API(db_path, raise_when_no_account=True, wait_timeout=20, wait_interval=1)
        self.configured = False

    async def configure(self, payload):
        cookies = payload.get("cookieHeader", "").strip()
        if "auth_token=" not in cookies or "ct0=" not in cookies:
            raise ValueError("Cookie 必须包含 auth_token 和 ct0")
        await self.api.pool.add_account_cookies(payload.get("alias") or "desktop-monitor", cookies)
        self.configured = True
        return {"configured": True}

    async def health(self, _payload):
        accounts = await self.api.pool.get_all()
        active = [a for a in accounts if value(a, "active", default=False)]
        return {"ok": self.configured and len(active) > 0, "accounts": len(active)}

    async def fetch(self, payload):
        username = payload["username"].lstrip("@")
        limit = max(1, min(int(payload.get("limit", 10)), 30))
        user = await self.api.user_by_login(username)
        if user is None:
            raise ValueError(f"找不到 X 账号 @{username}")
        tweets = await gather(self.api.user_tweets_and_replies(user.id, limit=limit))
        return [self.normalize(t) for t in tweets]

    def normalize(self, tweet):
        author = value(tweet, "user")
        post_id = str(value(tweet, "id"))
        username = value(author, "username", default="unknown")
        quoted = value(tweet, "quotedTweet")
        reply_id = value(tweet, "inReplyToTweetId")
        reposted = value(tweet, "retweetedTweet")
        kind = "repost" if reposted else "quote" if quoted else "reply" if reply_id else "original"
        dt = value(tweet, "date")
        if dt and dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        media = []
        media_obj = value(tweet, "media")
        for item in value(media_obj, "photos", default=[]) or []:
            media.append({"type": "image", "url": value(item, "url", default="")})
        for item in value(media_obj, "videos", default=[]) or []:
            media.append({"type": "video", "url": value(item, "thumbnailUrl", "url", default="")})
        result = {
            "source": "twscrape", "postId": post_id, "authorId": str(value(author, "id", default="")),
            "username": username, "displayName": value(author, "displayname", "displayName", default=username),
            "text": value(tweet, "rawContent", default=""), "language": value(tweet, "lang", default=""),
            "publishedAt": dt.isoformat() if dt else "", "url": f"https://x.com/{username}/status/{post_id}",
            "postType": kind, "media": media,
            "metrics": {"likes": value(tweet, "likeCount", default=0), "replies": value(tweet, "replyCount", default=0), "reposts": value(tweet, "retweetCount", default=0), "views": value(tweet, "viewCount", default=0)}
        }
        if quoted:
            qid = str(value(quoted, "id")); quser = value(value(quoted, "user"), "username", default="i")
            result["quotedPost"] = {"postId": qid, "url": f"https://x.com/{quser}/status/{qid}", "text": value(quoted, "rawContent", default="")}
        if reply_id:
            result["repliedToPost"] = {"postId": str(reply_id), "url": f"https://x.com/i/status/{reply_id}"}
        return result


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    args = parser.parse_args()
    collector = Collector(args.db)
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        req = json.loads(line)
        try:
            if req["action"] == "shutdown":
                print(json.dumps({"id": req["id"], "ok": True, "result": {}}), flush=True)
                break
            handler = getattr(collector, req["action"])
            result = await handler(req.get("payload", {}))
            print(json.dumps({"id": req["id"], "ok": True, "result": result}, ensure_ascii=False), flush=True)
        except Exception as exc:
            print(json.dumps({"id": req.get("id"), "ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    configure_stdio()
    asyncio.run(main())
