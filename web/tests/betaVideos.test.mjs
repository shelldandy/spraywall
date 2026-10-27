import assert from "node:assert/strict";
import test from "node:test";
import { betaVideoPlatformIcon, parseBetaVideoURL } from "../src/lib/betaVideos.ts";

const youtubeID = "dQw4w9WgXcQ";

test("normalizes supported beta video URL variants", () => {
  const cases = [
    [`https://youtube.com/watch?v=${youtubeID}&feature=share`, "youtube", youtubeID, `https://www.youtube.com/watch?v=${youtubeID}`],
    [`https://youtu.be/${youtubeID}`, "youtube", youtubeID, `https://www.youtube.com/watch?v=${youtubeID}`],
    [`https://www.youtube.com/shorts/${youtubeID}`, "youtube", youtubeID, `https://www.youtube.com/watch?v=${youtubeID}`],
    ["https://www.instagram.com/reel/CxYz_123/", "instagram", "CxYz_123", "https://www.instagram.com/reel/CxYz_123/"],
    ["https://instagram.com/p/ABC123/", "instagram", "ABC123", "https://www.instagram.com/p/ABC123/"],
    ["https://www.tiktok.com/@climber/video/1234567890123456789", "tiktok", "1234567890123456789", "https://www.tiktok.com/@climber/video/1234567890123456789"],
    ["https://vm.tiktok.com/ZMabc123/", "tiktok", "ZMabc123", "https://vm.tiktok.com/ZMabc123"],
    ["https://photos.example.net/share/Abc_123", "immich", null, "https://photos.example.net/share/Abc_123"],
    ["https://photos.example.net/s/slug-123", "immich", null, "https://photos.example.net/s/slug-123"],
  ];

  for (const [url, source, externalId, normalized] of cases) {
    assert.deepEqual(parseBetaVideoURL(url), { source, externalId, normalized }, url);
  }
});

test("rejects unsupported, malformed, and unsafe links", () => {
  for (const url of [
    "not a URL",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=short",
    "javascript:alert(1)",
    "https://user:pass@instagram.com/reel/ABC123",
  ]) {
    assert.equal(parseBetaVideoURL(url), null, url);
  }
});

test("provides platform badge glyphs", () => {
  assert.equal(betaVideoPlatformIcon("youtube"), "▶");
  assert.equal(betaVideoPlatformIcon("instagram"), "◎");
});
