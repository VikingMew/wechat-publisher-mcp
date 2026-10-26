#!/usr/bin/env python3
"""WeChat Official Account CLI. Python 3.10+, standard library only."""

import argparse
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import urllib.parse
import urllib.request
import uuid


COMMANDS = ("list-articles", "get-article-stats", "upload-cover",
            "upload-article-image", "create-draft")
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".webp": "image/webp"}
MAX_IMAGE_SIZE = 1024 * 1024


class WeChatError(Exception):
    def __init__(self, message, code="WECHAT_OPERATION_FAILED"):
        super().__init__(message)
        self.code = code


def invalid(message):
    raise WeChatError(message, "INVALID_ARGUMENT")


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def validate(command, params):
    if command not in COMMANDS:
        invalid("不支持的操作")
    if not isinstance(params, dict):
        invalid("输入必须为 JSON 对象")
    allowed = {
        "list-articles": {"offset", "count", "includeContent"},
        "get-article-stats": {"date", "msgId"},
        "upload-cover": {"imagePath"},
        "upload-article-image": {"imagePath"},
        "create-draft": {"title", "content", "author", "digest", "contentSourceUrl",
                         "thumbMediaId", "coverImagePath"},
    }
    if params.keys() - allowed[command]:
        invalid("包含不支持的参数；凭据只能通过环境变量提供")
    p = dict(params)
    if command == "list-articles":
        p = {"offset": 0, "count": 20, "includeContent": False, **p}
        if type(p["offset"]) is not int or p["offset"] < 0:
            invalid("offset 必须是非负整数")
        if type(p["count"]) is not int or not 1 <= p["count"] <= 20:
            invalid("count 必须是 1–20 的整数")
        if type(p["includeContent"]) is not bool:
            invalid("includeContent 必须是布尔值")
    elif command == "get-article-stats":
        value = p.get("date")
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            invalid("date 必须是 YYYY-MM-DD")
        try:
            day = date.fromisoformat(value)
        except ValueError:
            invalid("date 必须是有效日期")
        today = datetime.now(timezone(timedelta(hours=8))).date()
        if not date(2025, 11, 1) <= day < today:
            invalid("date 必须是 2025-11-01 起、北京时间今天之前的发表日期")
        if "msgId" in p and not nonempty(p["msgId"]):
            invalid("msgId 必须是非空字符串")
    elif command.startswith("upload-"):
        if not nonempty(p.get("imagePath")):
            invalid("imagePath 必须是非空字符串")
    else:
        for field in ("title", "content"):
            if not nonempty(p.get(field)):
                invalid(f"{field} 必须是非空字符串")
        if ("thumbMediaId" in p) == ("coverImagePath" in p):
            invalid("thumbMediaId 和 coverImagePath 必须且只能提供一个")
        for field in ("thumbMediaId", "coverImagePath"):
            if field in p and not nonempty(p[field]):
                invalid(f"{field} 必须是非空字符串")
        for field in ("author", "digest"):
            if field in p and not isinstance(p[field], str):
                invalid(f"{field} 必须是字符串")
        if "contentSourceUrl" in p:
            value = p["contentSourceUrl"]
            try:
                url = urllib.parse.urlsplit(value) if isinstance(value, str) else None
                valid = url and url.scheme in ("http", "https") and url.hostname
            except ValueError:
                valid = False
            if not valid:
                invalid("contentSourceUrl 必须是 HTTP(S) URL")
    return p


def read_image(file_path, article_image=False):
    allowed = {".png", ".jpg", ".jpeg"} if article_image else IMAGE_TYPES.keys()
    if not nonempty(file_path) or ".." in file_path:
        invalid("图片路径不能为空或包含 ..")
    if Path(file_path).suffix.lower() not in allowed:
        invalid("正文图片仅支持 PNG/JPEG" if article_image else "图片仅支持 PNG/JPEG/GIF/WebP")
    try:
        directory = Path(os.environ.get("WECHAT_COVER_DIR") or "./covers").resolve(strict=True)
        resolved = Path(file_path).resolve(strict=True)
        if resolved == directory or not resolved.is_relative_to(directory):
            invalid("图片路径超出允许目录 WECHAT_COVER_DIR（默认 ./covers）")
        ext = resolved.suffix.lower()
        if ext not in allowed:
            invalid("图片实际文件格式不受支持")
        fd = os.open(resolved, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode):
                invalid("图片必须是普通文件")
            if info.st_size > MAX_IMAGE_SIZE:
                invalid("图片不能超过 1 MB")
            data = handle.read(MAX_IMAGE_SIZE + 1)
        if len(data) > MAX_IMAGE_SIZE:
            invalid("图片不能超过 1 MB")
        signatures = {
            ".png": data.startswith(b"\x89PNG\r\n\x1a\n"),
            ".jpg": data.startswith(b"\xff\xd8\xff"),
            ".jpeg": data.startswith(b"\xff\xd8\xff"),
            ".gif": data.startswith((b"GIF87a", b"GIF89a")),
            ".webp": len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP",
        }
        if not signatures[ext]:
            invalid("图片魔数无效或与扩展名不匹配")
        return ext, data
    except (OSError, ValueError, RuntimeError):
        invalid("图片读取失败，请检查目录、文件及访问权限")


class WeChatAPI:
    def __init__(self):
        self.app_id = os.environ.get("WECHAT_APP_ID", "").strip()
        self.app_secret = os.environ.get("WECHAT_APP_SECRET", "").strip()
        if not self.app_id or not self.app_secret:
            raise WeChatError("缺少环境变量 WECHAT_APP_ID 或 WECHAT_APP_SECRET")
        if not re.fullmatch(r"wx[a-zA-Z0-9]{16}", self.app_id) or len(self.app_secret) != 32:
            raise WeChatError("WECHAT_APP_ID 或 WECHAT_APP_SECRET 格式错误")
        self.token = None
        self.token_expires = 0

    @staticmethod
    def _request(endpoint, query, body=None, content_type=None):
        url = "https://api.weixin.qq.com/" + endpoint + "?" + urllib.parse.urlencode(query)
        headers = {"Content-Type": content_type} if content_type else {}
        request = urllib.request.Request(url, data=body, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.loads(response.read().decode("utf-8"))
        except Exception:
            # Never forward HTTP exceptions: their URLs can contain credentials/tokens.
            raise WeChatError("微信请求失败，请检查网络、IP 白名单及接口权限") from None
        if not isinstance(result, dict):
            raise WeChatError("微信响应格式无效")
        if result.get("errcode"):
            code = result["errcode"]
            if code == 47009:
                raise WeChatError("微信接口已下线（错误码 47009）")
            detail = f"（错误码 {code}）" if type(code) is int else ""
            raise WeChatError(f"微信操作失败{detail}，请检查接口权限及参数")
        return result

    def access_token(self):
        now = time.time()
        if self.token and now < self.token_expires:
            return self.token
        data = self._request("cgi-bin/token", {
            "grant_type": "client_credential", "appid": self.app_id, "secret": self.app_secret,
        })
        if not nonempty(data.get("access_token")) or type(data.get("expires_in")) is not int:
            raise WeChatError("获取 access_token 响应无效")
        self.token = data["access_token"]
        self.token_expires = now + data["expires_in"] - 60
        return self.token

    def post(self, endpoint, payload):
        return self._request(endpoint, {"access_token": self.access_token()},
                             json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                             "application/json; charset=utf-8")

    def upload(self, image, article_image=False):
        ext, content = image
        boundary = "wechat-" + uuid.uuid4().hex
        body = (f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="media"; filename="image{ext}"\r\n'
                f"Content-Type: {IMAGE_TYPES[ext]}\r\n\r\n").encode("ascii")
        body += content + f"\r\n--{boundary}--\r\n".encode("ascii")
        query = {"access_token": self.access_token()}
        endpoint = "cgi-bin/media/uploadimg" if article_image else "cgi-bin/material/add_material"
        if not article_image:
            query["type"] = "image"
        data = self._request(endpoint, query, body, f"multipart/form-data; boundary={boundary}")
        field = "url" if article_image else "media_id"
        if not nonempty(data.get(field)):
            raise WeChatError("图片上传响应缺少 " + field)
        return {"url" if article_image else "mediaId": data[field]}

    def list_articles(self, p):
        data = self.post("cgi-bin/freepublish/batchget", {
            "offset": p["offset"], "count": p["count"], "no_content": 0 if p["includeContent"] else 1,
        })
        items = []
        for item in data["item"]:
            articles = []
            for index, article in enumerate(item["content"]["news_item"]):
                mapped = {"index": index, "title": article["title"],
                          "author": article.get("author"), "digest": article.get("digest"),
                          "url": article.get("url"), "thumbMediaId": article.get("thumb_media_id")}
                if p["includeContent"]:
                    mapped["content"] = article.get("content")
                articles.append(mapped)
            items.append({"articleId": item["article_id"], "updateTime": item["update_time"], "articles": articles})
        next_offset = p["offset"] + data["item_count"]
        return {"totalCount": data["total_count"], "itemCount": data["item_count"], "offset": p["offset"],
                "nextOffset": next_offset if data["item_count"] > 0 and next_offset < data["total_count"] else None,
                "items": items}

    def article_stats(self, p):
        data = self.post("datacube/getarticletotaldetail", {"begin_date": p["date"], "end_date": p["date"]})
        items = []
        for item in data["list"]:
            if "msgId" in p and item["msgid"] != p["msgId"]:
                continue
            items.append({
                "msgId": item["msgid"], "title": item["title"], "refDate": item["ref_date"],
                "url": item.get("content_url"), "publishType": item.get("publish_type"),
                "snapshots": [{"statDate": d["stat_date"], "readUsers": d.get("read_user"),
                               "shareUsers": d.get("share_user"), "favoriteUsers": d.get("collection_user")}
                              for d in item["detail_list"]],
            })
        return {"date": p["date"], "isDelayed": data.get("is_delay"), "items": items}

    def create_draft(self, p, image=None):
        thumb = self.upload(image)["mediaId"] if image is not None else p["thumbMediaId"]
        article = {"title": p["title"], "content": p["content"], "thumb_media_id": thumb}
        for field, target in (("author", "author"), ("digest", "digest"), ("contentSourceUrl", "content_source_url")):
            if field in p:
                article[target] = p[field]
        data = self.post("cgi-bin/draft/add", {"articles": [article]})
        if not nonempty(data.get("media_id")):
            raise WeChatError("保存草稿响应缺少 media_id，无法确认草稿已保存")
        return {"mediaId": data["media_id"], "status": "draft"}


def execute(command, params):
    try:
        p = validate(command, params)
        image = None
        if command.startswith("upload-"):
            image = read_image(p["imagePath"], command == "upload-article-image")
        elif command == "create-draft" and "coverImagePath" in p:
            image = read_image(p["coverImagePath"])
        api = WeChatAPI()
        if command == "list-articles":
            result = api.list_articles(p)
        elif command == "get-article-stats":
            result = api.article_stats(p)
        elif command == "create-draft":
            result = api.create_draft(p, image)
        else:
            result = api.upload(image, command == "upload-article-image")
        return {"success": True, **result}
    except WeChatError as error:
        return {"success": False, "error": error.code, "message": str(error)}
    except (KeyError, TypeError, ValueError):
        return {"success": False, "error": "WECHAT_OPERATION_FAILED", "message": "微信响应格式无效"}


def main(argv=None):
    parser = argparse.ArgumentParser(description="微信公众号操作：Python 标准库，无 MCP/Node 依赖")
    parser.add_argument("command", choices=COMMANDS)
    parser.add_argument("--input", default="-", metavar="JSON_FILE", help="UTF-8 JSON 参数文件；默认 - 从 stdin 读取")
    args = parser.parse_args(argv)
    try:
        if args.input == "-":
            source = sys.stdin.read()
        else:
            source = Path(args.input).read_text(encoding="utf-8")
        params = json.loads(source)
        result = execute(args.command, params)
    except (OSError, ValueError):
        result = {"success": False, "error": "INVALID_ARGUMENT", "message": "无法读取参数，请提供 UTF-8 JSON 对象"}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
