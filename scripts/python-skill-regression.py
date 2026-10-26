#!/usr/bin/env python3
"""Offline tests: standard library only, fake credentials and HTTP responses."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/wechat-official-account/scripts/wechat.py"
spec = importlib.util.spec_from_file_location("wechat_skill", SCRIPT)
wechat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wechat)
PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x00"
SECRET = "a" * 32


class SkillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="wechat-python-offline-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.covers = self.root / "covers"
        self.covers.mkdir()
        self.cover = self.covers / "cover.png"
        self.cover.write_bytes(PNG)
        self.env = patch.dict(os.environ, {"WECHAT_APP_ID": "wx1234567890abcdef",
                                         "WECHAT_APP_SECRET": SECRET,
                                         "WECHAT_COVER_DIR": str(self.covers)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.requests = []
        self.responses = {
            "/cgi-bin/token": {"access_token": "offline-token", "expires_in": 7200},
            "/cgi-bin/material/add_material": {"media_id": "cover-123", "private": "RAW_SECRET"},
            "/cgi-bin/media/uploadimg": {"url": "http://mmbiz.qpic.cn/offline", "private": "RAW_SECRET"},
            "/cgi-bin/draft/add": {"media_id": "draft-123", "private": "RAW_SECRET"},
            "/cgi-bin/freepublish/batchget": {
                "total_count": 3, "item_count": 1, "item": [{
                    "article_id": "article-123", "update_time": 1700000000,
                    "content": {"news_item": [
                        {"title": "PRIVATE_TITLE", "content": "PRIVATE_BODY", "author": "作者"},
                        {"title": "第二篇"}]} }]},
            "/datacube/getarticletotaldetail": {
                "is_delay": False, "list": [{"msgid": "12003_1", "title": "PRIVATE_TITLE",
                    "ref_date": "2025-11-01", "content_url": "https://example.com/article", "publish_type": 1,
                    "detail_list": [{"stat_date": "2025-11-01", "read_user": 8, "share_user": 0},
                                    {"stat_date": "2025-11-02", "read_user": 12, "share_user": 2, "collection_user": 1}]}]},
        }
        self.http = patch.object(wechat.urllib.request, "urlopen", side_effect=self.urlopen)
        self.http.start()
        self.addCleanup(self.http.stop)

    def urlopen(self, request, timeout):
        url = urlsplit(request.full_url)
        self.assertEqual(url.scheme, "https")
        self.assertEqual(url.hostname, "api.weixin.qq.com")
        query = parse_qs(url.query)
        if url.path == "/cgi-bin/token":
            self.assertEqual(query["secret"], [SECRET])
        else:
            self.assertEqual(query["access_token"], ["offline-token"])
        self.requests.append(request)
        result = self.responses[url.path]  # Unlisted endpoints fail; no real HTTP.
        if isinstance(result, Exception):
            raise result
        return io.BytesIO(json.dumps(result).encode("utf-8"))

    def call(self, command, params):
        return wechat.execute(command, params)

    def sent_payload(self):
        return json.loads(self.requests[-1].data)

    def test_list_pagination_grouping_and_content(self):
        result = self.call("list-articles", {})
        self.assertTrue(result["success"])
        self.assertEqual(self.sent_payload(), {"offset": 0, "count": 20, "no_content": 1})
        self.assertEqual(result["nextOffset"], 1)
        self.assertEqual(len(result["items"][0]["articles"]), 2)
        self.assertEqual(result["items"][0]["articles"][1]["index"], 1)
        self.assertNotIn("PRIVATE_BODY", json.dumps(result))
        result = self.call("list-articles", {"offset": 2, "count": 1, "includeContent": True})
        self.assertEqual(self.sent_payload()["no_content"], 0)
        self.assertIsNone(result["nextOffset"])
        self.assertEqual(result["items"][0]["articles"][0]["content"], "PRIVATE_BODY")
        self.responses["/cgi-bin/freepublish/batchget"] = {"total_count": 0, "item_count": 0, "item": []}
        result = self.call("list-articles", {})
        self.assertEqual(result["items"], [])
        self.assertIsNone(result["nextOffset"])

    def test_stats_snapshots_null_zero_filter_delay(self):
        result = self.call("get-article-stats", {"date": "2025-11-01"})
        self.assertEqual(self.sent_payload(), {"begin_date": "2025-11-01", "end_date": "2025-11-01"})
        self.assertFalse(result["isDelayed"])
        item = result["items"][0]
        self.assertEqual(item["publishType"], 1)
        self.assertEqual([v["readUsers"] for v in item["snapshots"]], [8, 12])
        self.assertEqual(item["snapshots"][0]["shareUsers"], 0)
        self.assertIsNone(item["snapshots"][0]["favoriteUsers"])
        self.assertEqual(item["snapshots"][1]["favoriteUsers"], 1)
        self.assertEqual(self.call("get-article-stats", {"date": "2025-11-01", "msgId": "12003_2"})["items"], [])
        self.responses["/datacube/getarticletotaldetail"] = {"list": [], "is_delay": True}
        self.assertTrue(self.call("get-article-stats", {"date": "2025-11-01"})["isDelayed"])

    def test_strict_input_validation_before_http(self):
        cases = [("list-articles", p) for p in [None, [], {"count": True}, {"count": 0}, {"count": 21},
                 {"count": "2"}, {"offset": -1}, {"offset": 0.5}, {"includeContent": "false"}, {"appSecret": SECRET}]]
        cases += [("get-article-stats", {"date": day}) for day in [None, "", "2025-10-31", "2025-11-31", "9999-01-01", "2025-1-1"]]
        cases += [("get-article-stats", {"date": "2025-11-01", "msgId": ""}), ("publish", {}),
                  ("upload-cover", {"imagePath": 1}), ("upload-article-image", {})]
        for command, params in cases:
            with self.subTest(command=command, params=params):
                self.assertEqual(self.call(command, params)["error"], "INVALID_ARGUMENT")
        self.assertEqual(self.requests, [])

    def test_draft_exact_html_and_optional_fields(self):
        content = '<p>中文 $HOME `example`</p>\n<pre>  code\n next</pre>'
        params = {"title": "PRIVATE_TITLE", "content": content, "thumbMediaId": "existing", "author": "作者",
                  "digest": "PRIVATE_DIGEST", "contentSourceUrl": "https://example.com/source"}
        self.assertEqual(self.call("create-draft", params), {"success": True, "mediaId": "draft-123", "status": "draft"})
        self.assertEqual(self.sent_payload(), {"articles": [{"title": params["title"], "content": content,
                         "thumb_media_id": "existing", "author": "作者", "digest": "PRIVATE_DIGEST",
                         "content_source_url": "https://example.com/source"}]})
        self.assertEqual([urlsplit(r.full_url).path for r in self.requests], ["/cgi-bin/token", "/cgi-bin/draft/add"])

    def test_local_cover_draft_and_upload_failure(self):
        params = {"title": "标题", "content": "<p>正文</p>", "coverImagePath": str(self.cover)}
        self.assertTrue(self.call("create-draft", params)["success"])
        article = self.sent_payload()["articles"][0]
        self.assertEqual(article["thumb_media_id"], "cover-123")
        self.assertNotIn("author", article)
        self.assertNotIn("digest", article)
        self.requests.clear()
        self.responses["/cgi-bin/material/add_material"] = {"errcode": 48001, "errmsg": "RAW_SECRET"}
        self.assertFalse(self.call("create-draft", params)["success"])
        self.assertNotIn("/cgi-bin/draft/add", [urlsplit(r.full_url).path for r in self.requests])

    def test_invalid_drafts_never_request(self):
        base = {"title": "标题", "content": "<p>正文</p>", "thumbMediaId": "existing"}
        for p in [{"title": "x", "content": "x"}, {**base, "coverImagePath": str(self.cover)},
                  {**base, "title": " "}, {**base, "content": 1}, {**base, "thumbMediaId": None},
                  {**base, "author": False}, {**base, "contentSourceUrl": "bad-url"}, {**base, "confirmPublish": True}]:
            self.assertEqual(self.call("create-draft", p)["error"], "INVALID_ARGUMENT")
        self.assertEqual(self.requests, [])

    def test_upload_multipart_and_result_projection(self):
        for command, expected, endpoint in [
            ("upload-cover", {"success": True, "mediaId": "cover-123"}, "/cgi-bin/material/add_material"),
            ("upload-article-image", {"success": True, "url": "http://mmbiz.qpic.cn/offline"}, "/cgi-bin/media/uploadimg")]:
            self.assertEqual(self.call(command, {"imagePath": str(self.cover)}), expected)
            request = self.requests[-1]
            url = urlsplit(request.full_url)
            self.assertEqual(url.path, endpoint)
            self.assertEqual(parse_qs(url.query).get("type"), ["image"] if command == "upload-cover" else None)
            self.assertIn(b'name="media"; filename="image.png"\r\n', request.data)
            self.assertIn(b"Content-Type: image/png\r\n\r\n" + PNG, request.data)
            boundary = request.headers["Content-type"].split("boundary=")[1].encode()
            self.assertTrue(request.data.endswith(b"\r\n--" + boundary + b"--\r\n"))

    def test_image_types_and_validated_bytes(self):
        for ext, content in [("png", PNG), ("jpg", b"\xff\xd8\xff"), ("jpeg", b"\xff\xd8\xff"),
                             ("gif", b"GIF89a"), ("webp", b"RIFF0000WEBP")]:
            file = self.covers / ("image." + ext)
            file.write_bytes(content)
            result = self.call("upload-cover", {"imagePath": str(file)})
            self.assertTrue(result["success"])
            result = self.call("upload-article-image", {"imagePath": str(file)})
            self.assertEqual(result["success"], ext in ("png", "jpg", "jpeg"))
        image = wechat.read_image(str(self.cover))
        self.cover.write_text("replaced")
        wechat.WeChatAPI().upload(image)
        self.assertIn(PNG, self.requests[-1].data)
        self.assertNotIn(b"replaced", self.requests[-1].data)

    def test_image_boundaries_before_network(self):
        outside = self.root / "outside.png"
        outside.write_bytes(PNG)
        (self.covers / "fake.png").write_text("not image")
        (self.covers / "large.png").write_bytes(PNG + b"0" * wechat.MAX_IMAGE_SIZE)
        (self.covers / "dir.png").mkdir()
        paths = [outside, self.covers / "../outside.png"] + [self.covers / name for name in
                 ("fake.png", "large.png", "dir.png", "missing.png")]
        for command in ("upload-cover", "upload-article-image"):
            for file in paths:
                self.assertEqual(self.call(command, {"imagePath": str(file)})["error"], "INVALID_ARGUMENT")
        self.assertEqual(self.requests, [])

    def test_symbolic_link_boundaries(self):
        outside = self.root / "outside.png"
        outside.write_bytes(PNG)
        (self.covers / "image.gif").write_bytes(b"GIF89a")
        (self.covers / "outside-link.png").symlink_to(outside)
        (self.covers / "gif-link.png").symlink_to(self.covers / "image.gif")
        for command in ("upload-cover", "upload-article-image"):
            self.assertFalse(self.call(command, {"imagePath": str(self.covers / "outside-link.png")})["success"])
        self.assertFalse(self.call("upload-article-image", {"imagePath": str(self.covers / "gif-link.png")})["success"])
        self.assertEqual(self.requests, [])

    def windows_open_environment(self, before_open=None):
        # Exercise missing flags without changing os globally or pretending this
        # Linux test is a native Windows filesystem test.
        simulated = SimpleNamespace(**vars(os))
        for flag in ("O_NOFOLLOW", "O_NONBLOCK"):
            simulated.__dict__.pop(flag, None)
        binary_flag = 1 << 29
        simulated.O_BINARY = binary_flag

        def open_binary(file, flags):
            self.assertTrue(flags & binary_flag, "Windows images must be opened in binary mode")
            if before_open:
                before_open(file)
            return os.open(file, flags & ~binary_flag | getattr(os, "O_BINARY", 0))

        simulated.open = open_binary
        return patch.object(wechat, "os", simulated)

    def test_upload_and_draft_without_unix_flags(self):
        data = PNG + b"\r\n\x1a\xff\x00"
        self.cover.write_bytes(data)
        with self.windows_open_environment():
            for command in ("upload-cover", "upload-article-image"):
                self.assertTrue(self.call(command, {"imagePath": str(self.cover)})["success"])
                self.assertIn(b"\r\n\r\n" + data + b"\r\n--", self.requests[-1].data)
            self.assertTrue(self.call("create-draft", {
                "title": "标题", "content": "<p>正文</p>", "coverImagePath": str(self.cover)})["success"])
            self.assertEqual(self.sent_payload()["articles"][0]["thumb_media_id"], "cover-123")
            self.cover.write_text("fake image")
            before = len(self.requests)
            self.assertFalse(self.call("upload-cover", {"imagePath": str(self.cover)})["success"])
            self.assertEqual(len(self.requests), before)

    def test_file_replaced_before_open_without_nofollow(self):
        replacement = self.covers / "replacement.png"
        replacement.write_bytes(PNG + b"replacement")

        def replace(file):
            replacement.replace(file)

        with self.windows_open_environment(replace):
            result = self.call("upload-cover", {"imagePath": str(self.cover)})
        self.assertEqual(result["error"], "INVALID_ARGUMENT")
        self.assertIn("发生变化", result["message"])
        self.assertEqual(self.requests, [])

    def test_cli_utf8_streams_and_bom_file(self):
        # Force a legacy stream encoding as on Windows redirected stdin/stdout.
        env = {**os.environ, "WECHAT_APP_ID": "", "WECHAT_APP_SECRET": "", "PYTHONIOENCODING": "ascii"}
        params = {"imagePath": str(self.covers / "中文图片.png")}
        payload = json.dumps(params, ensure_ascii=False).encode("utf-8-sig")
        params_file = self.root / "params.json"
        params_file.write_bytes(payload)
        for args, stdin in [([], payload), (["--input", str(params_file)], b"")]:
            child = subprocess.run([sys.executable, "-B", str(SCRIPT), "upload-cover", *args],
                                   input=stdin, env=env, capture_output=True, timeout=10)
            self.assertEqual(child.returncode, 1)
            result = json.loads(child.stdout.decode("utf-8"))
            self.assertEqual(result["error"], "INVALID_ARGUMENT")
            self.assertIn("图片读取失败", result["message"])
            self.assertEqual(child.stderr, b"")

    def test_default_directory(self):
        old_cwd = os.getcwd()
        try:
            os.chdir(self.root)
            del os.environ["WECHAT_COVER_DIR"]
            self.assertEqual(wechat.read_image("covers/cover.png"), (".png", PNG))
        finally:
            os.chdir(old_cwd)

    def test_errors_are_sanitized_and_invalid_success_rejected(self):
        for endpoint, command, params, field in [
            ("/cgi-bin/material/add_material", "upload-cover", {"imagePath": str(self.cover)}, "media_id"),
            ("/cgi-bin/media/uploadimg", "upload-article-image", {"imagePath": str(self.cover)}, "url"),
            ("/cgi-bin/draft/add", "create-draft", {"title": "x", "content": "x", "thumbMediaId": "cover"}, "media_id")]:
            for response in [{"errcode": 48001, "errmsg": SECRET}, OSError("URL?secret=" + SECRET), {}, {field: ""}, {field: 123}]:
                self.responses[endpoint] = response
                result = self.call(command, params)
                self.assertFalse(result["success"])
                self.assertNotIn(SECRET, json.dumps(result))
                self.assertNotIn("offline-token", json.dumps(result))
        self.responses["/cgi-bin/freepublish/batchget"] = {"errcode": 47009, "errmsg": "RAW_SECRET"}
        self.assertIn("47009", self.call("list-articles", {})["message"])
        self.responses["/cgi-bin/freepublish/batchget"] = {}
        self.assertFalse(self.call("list-articles", {})["success"])

    def test_token_cache_expiry_and_credentials(self):
        with patch.object(wechat.time, "time", return_value=100):
            api = wechat.WeChatAPI()
            self.assertEqual(api.access_token(), "offline-token")
            self.assertEqual(api.token_expires, 7240)
            api.access_token()
            self.assertEqual(len(self.requests), 1)
        with patch.object(wechat.time, "time", return_value=7240):
            api.access_token()
            self.assertEqual(len(self.requests), 2)
        for response in [{"errcode": 40013, "errmsg": SECRET}, {}, OSError(SECRET)]:
            self.responses["/cgi-bin/token"] = response
            result = self.call("list-articles", {})
            self.assertFalse(result["success"])
            self.assertNotIn(SECRET, json.dumps(result))
        before = len(self.requests)
        del os.environ["WECHAT_APP_SECRET"]
        self.assertIn("WECHAT_APP_SECRET", self.call("list-articles", {})["message"])
        self.assertEqual(len(self.requests), before)

    def test_cli_json_stdin_file_and_no_diagnostic_leaks(self):
        for source, command, code in [("{}", "list-articles", 0), ("broken", "list-articles", 1),
                                      ('{"count":true}', "list-articles", 1)]:
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch.object(sys, "stdin", io.StringIO(source)), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                self.assertEqual(wechat.main([command]), code)
            json.loads(stdout.getvalue())
            self.assertEqual(stderr.getvalue(), "")
            self.assertNotIn(SECRET, stdout.getvalue())
        params_file = self.root / "params.json"
        params_file.write_text('{"date":"2025-11-01"}')
        with contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(wechat.main(["get-article-stats", "--input", str(params_file)]), 0)
        self.assertEqual(json.loads(output.getvalue())["items"][0]["snapshots"][0]["readUsers"], 8)

    def test_copied_script_runs_without_site_packages_or_repo(self):
        standalone = self.root / "wechat.py"
        shutil.copyfile(SCRIPT, standalone)
        env = {**os.environ, "WECHAT_APP_ID": "", "WECHAT_APP_SECRET": ""}
        child = subprocess.run([sys.executable, "-S", str(standalone), "--help"], cwd=self.root,
                               env=env, capture_output=True, text=True, encoding="utf-8", timeout=10)
        self.assertEqual(child.returncode, 0)
        self.assertIn("upload-article-image", child.stdout)
        child = subprocess.run([sys.executable, "-S", str(standalone), "list-articles"], input="{}",
                               cwd=self.root, env=env, capture_output=True, text=True, encoding="utf-8", timeout=10)
        self.assertEqual(child.returncode, 1)
        self.assertIn("WECHAT_APP_SECRET", json.loads(child.stdout)["message"])
        self.assertEqual(child.stderr, "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
