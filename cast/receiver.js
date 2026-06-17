// receiver.js

const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

console.log("=================================");
console.log("PreetTV Cast Receiver Starting");
console.log("=================================");

/**
 * Detect mime type from URL
 */
function detectMimeTypeFromUrl(url) {

    const lower = url.toLowerCase();

    if (lower.includes(".m3u8")) {
        return "application/x-mpegURL";
    }

    if (lower.includes(".mpd")) {
        return "application/dash+xml";
    }

    if (lower.includes(".mp4")) {
        return "video/mp4";
    }

    if (lower.includes(".mp3")) {
        return "audio/mpeg";
    }

    if (lower.includes(".aac")) {
        return "audio/aac";
    }

    if (lower.includes(".ts")) {
        return "video/mp2t";
    }

    return null;
}

/**
 * Detect mime type from Content-Type header
 */
function detectMimeTypeFromHeader(contentType) {

    if (!contentType) {
        return null;
    }

    const lower = contentType.toLowerCase();

    if (
        lower.includes("application/vnd.apple.mpegurl") ||
        lower.includes("application/x-mpegurl") ||
        lower.includes("mpegurl")
    ) {
        return "application/x-mpegURL";
    }

    if (
        lower.includes("dash+xml")
    ) {
        return "application/dash+xml";
    }

    if (
        lower.includes("video/mp4")
    ) {
        return "video/mp4";
    }

    if (
        lower.includes("audio/mpeg")
    ) {
        return "audio/mpeg";
    }

    if (
        lower.includes("audio/aac")
    ) {
        return "audio/aac";
    }

    if (
        lower.includes("video/mp2t")
    ) {
        return "video/mp2t";
    }

    return null;
}

/**
 * Resolve URL and inspect response
 */
async function resolveStream(url, headers = {}) {

    try {

        console.log("Resolving URL:", url);

        const response = await fetch(url, {
            method: "GET",
            redirect: "follow",
            headers: headers
        });

        const finalUrl = response.url;

        const contentType =
            response.headers.get("content-type");

        console.log("Resolved URL:", finalUrl);
        console.log("Response Content-Type:", contentType);

        return {
            finalUrl,
            mimeType: detectMimeTypeFromHeader(contentType)
        };

    } catch (e) {

        console.error("Resolution failed", e);

        return {
            finalUrl: url,
            mimeType: null
        };
    }
}

/**
 * Inject headers into all requests
 */
playerManager.setMediaPlaybackInfoHandler(
    (loadRequestData, playbackConfig) => {

        const headers =
            loadRequestData.customData?.headers || {};

        console.log("Playback headers:", headers);

        playbackConfig.manifestRequestHandler =
            request => {

                Object.entries(headers).forEach(
                    ([key, value]) => {
                        request.headers[key] = value;
                    }
                );
            };

        playbackConfig.segmentRequestHandler =
            request => {

                Object.entries(headers).forEach(
                    ([key, value]) => {
                        request.headers[key] = value;
                    }
                );
            };

        playbackConfig.licenseRequestHandler =
            request => {

                Object.entries(headers).forEach(
                    ([key, value]) => {
                        request.headers[key] = value;
                    }
                );
            };

        return playbackConfig;
    }
);

/**
 * Intercept LOAD request
 */
playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.LOAD,
    async (loadRequestData) => {

        try {

            const media = loadRequestData.media;

            if (!media || !media.contentId) {

                console.error("Missing media URL");

                throw new cast.framework.messages.ErrorData(
                    cast.framework.messages.ErrorType.LOAD_FAILED
                );
            }

            const originalUrl =
                media.contentId;

            const customData =
                loadRequestData.customData || {};

            const headers =
                customData.headers || {};

            console.log("--------------------------------");
            console.log("Incoming URL:", originalUrl);
            console.log("Custom Data:", customData);
            console.log("--------------------------------");

            const resolved =
                await resolveStream(
                    originalUrl,
                    headers
                );

            media.contentId =
                resolved.finalUrl;

            let mimeType =
                media.contentType;

            if (!mimeType) {

                mimeType =
                    resolved.mimeType;

                if (!mimeType) {

                    mimeType =
                        detectMimeTypeFromUrl(
                            resolved.finalUrl
                        );
                }

                if (!mimeType) {

                    /**
                     * IPTV fallback
                     */
                    mimeType =
                        "application/x-mpegURL";
                }
            }

            media.contentType = mimeType;

            console.log("Final URL:", media.contentId);
            console.log("Detected MIME:", mimeType);

            return loadRequestData;

        } catch (e) {

            console.error("LOAD interceptor error", e);

            throw e;
        }
    }
);

/**
 * Error logging
 */
playerManager.addEventListener(
    cast.framework.events.EventType.ERROR,
    event => {

        console.error("PLAYER ERROR");
        console.error(event);
    }
);

/**
 * Playback state changes
 */
playerManager.addEventListener(
    cast.framework.events.EventType.MEDIA_STATUS,
    event => {

        console.log("MEDIA STATUS");
        console.log(event);
    }
);

/**
 * Start CAF
 */
context.start({
    disableIdleTimeout: true
});

console.log("=================================");
console.log("PreetTV Cast Receiver Ready");
console.log("=================================");