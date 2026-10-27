import type { BetaVideoSource } from "./api/types";

export interface ParsedBetaVideoURL {
  source: BetaVideoSource;
  externalId: string | null;
  normalized: string;
}

const youtubeID = /^[A-Za-z0-9_-]{11}$/;
const shortcode = /^[A-Za-z0-9_-]{1,128}$/;

export function parseBetaVideoURL(raw: string): ParsedBetaVideoURL | null {
  const value = raw.trim();
  if (!value || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.hash) return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const segments = url.pathname.split("/").filter(Boolean);
  const id = (source: BetaVideoSource, externalId: string | null, normalized: string): ParsedBetaVideoURL => ({
    source,
    externalId,
    normalized,
  });

  if (segments.length === 2 && (segments[0] === "share" || segments[0] === "s") && shortcode.test(segments[1])) {
    return id("immich", null, `${url.origin}/${segments[0]}/${segments[1]}`);
  }

  let youtubeVideoId = "";
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host) && !url.port) {
    if (host === "youtu.be") youtubeVideoId = segments[0] ?? "";
    else if (segments.length === 2 && segments[0] === "shorts") youtubeVideoId = segments[1];
    else if (url.pathname === "/watch" || url.pathname === "/watch/") youtubeVideoId = url.searchParams.get("v") ?? "";
    if (youtubeID.test(youtubeVideoId)) {
      return id("youtube", youtubeVideoId, `https://www.youtube.com/watch?v=${youtubeVideoId}`);
    }
    return null;
  }

  if (["instagram.com", "www.instagram.com", "m.instagram.com"].includes(host) && !url.port && segments.length === 2 && ["reel", "p"].includes(segments[0])) {
    const shortcodeID = segments[1];
    if (!shortcode.test(shortcodeID)) return null;
    return id("instagram", shortcodeID, `https://www.instagram.com/${segments[0]}/${shortcodeID}/`);
  }

  if (["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"].includes(host) && !url.port) {
    let tiktokVideoId = "";
    const shortLink = host === "vm.tiktok.com" || host === "vt.tiktok.com";
    if (shortLink) tiktokVideoId = segments[0] ?? "";
    else {
      const videoIndex = segments.indexOf("video");
      if (videoIndex >= 0) tiktokVideoId = segments[videoIndex + 1] ?? "";
      else if (segments.length === 2 && segments[0] === "t") tiktokVideoId = segments[1];
    }
    if (!shortcode.test(tiktokVideoId)) return null;
    return id("tiktok", tiktokVideoId, `https://${shortLink ? host : "www.tiktok.com"}/${segments.join("/")}`);
  }

  return null;
}

export function betaVideoPlatformIcon(source: BetaVideoSource): string {
  switch (source) {
    case "immich": return "▣";
    case "youtube": return "▶";
    case "instagram": return "◎";
    case "tiktok": return "♪";
  }
}

export function betaVideoPlatformName(source: BetaVideoSource): string {
  switch (source) {
    case "immich": return "Immich";
    case "youtube": return "YouTube";
    case "instagram": return "Instagram";
    case "tiktok": return "TikTok";
  }
}
