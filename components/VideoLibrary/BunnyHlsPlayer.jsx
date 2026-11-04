import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

export default function BunnyHlsPlayer({
  src,
  fallbackSrc,
  title,
  poster,
  seekRequest,
  className = "",
  autoPlay = true,
  onReady,
  onError,
  onSubtitlesUnavailable,
  subtitlesLabel = "Subtitrări",
  subtitlesOffLabel = "Oprite",
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const callbacksRef = useRef({ onReady, onError, onSubtitlesUnavailable });
  const resumeRef = useRef(null);
  const appliedSeekRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failedSource, setFailedSource] = useState(null);
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState(-1);
  const activeSrc = failedSource === src && fallbackSrc ? fallbackSrc : src;

  useEffect(() => {
    callbacksRef.current = { onReady, onError, onSubtitlesUnavailable };
  }, [onReady, onError, onSubtitlesUnavailable]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeSrc) return undefined;

    let hls = null;
    setReady(false);
    setSubtitleTracks([]);
    setSelectedSubtitle(-1);

    const handlePlaybackError = (error) => {
      if (fallbackSrc && activeSrc !== fallbackSrc) {
        resumeRef.current = { seconds: video.currentTime, paused: video.readyState ? video.paused : !autoPlay };
        callbacksRef.current.onSubtitlesUnavailable?.(true);
        setFailedSource(src);
      } else {
        callbacksRef.current.onError?.(error);
      }
    };
    const nativeTracks = () => Array.from(video.textTracks || []).filter(
      track => track.kind === "subtitles" || track.kind === "captions"
    );
    const syncNativeTracks = () => {
      if (hls) return;
      const tracks = nativeTracks();
      setSubtitleTracks(tracks.map((track, id) => ({ id, label: track.label || track.language })));
      setSelectedSubtitle(tracks.findIndex(track => track.mode === "showing"));
    };
    const handleAddTrack = (event) => {
      if (!hls && event.track) event.track.mode = "disabled";
      syncNativeTracks();
    };

    const handleReady = () => {
      setReady(true);
      syncNativeTracks();
      const resume = resumeRef.current;
      resumeRef.current = null;
      if (resume && Number.isFinite(resume.seconds)) video.currentTime = resume.seconds;
      callbacksRef.current.onReady?.(video);
      if (resume ? !resume.paused : autoPlay) {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {});
        }
      } else if (resume?.paused) {
        video.pause();
      }
    };
    const handleError = () => handlePlaybackError(new Error("video_error"));

    video.addEventListener("loadedmetadata", handleReady);
    video.addEventListener("error", handleError);
    video.textTracks?.addEventListener("addtrack", handleAddTrack);
    video.textTracks?.addEventListener("removetrack", syncNativeTracks);
    video.textTracks?.addEventListener("change", syncNativeTracks);

    // Some browsers advertise native HLS but do not expose its subtitle tracks.
    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
        setSubtitleTracks(data.subtitleTracks.map((track, id) => ({ id, label: track.name || track.lang })));
      });
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => setSelectedSubtitle(data.id));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (/^subtitle/i.test(data?.details || "") || data?.frag?.type === "subtitle" || data?.context?.type === "subtitleTrack") {
          hls.subtitleTrack = -1;
          setSelectedSubtitle(-1);
          callbacksRef.current.onSubtitlesUnavailable?.(true);
        } else if (data?.fatal) {
          handlePlaybackError(data);
        }
      });
      hls.loadSource(activeSrc);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = activeSrc;
    } else {
      callbacksRef.current.onError?.(new Error("hls_not_supported"));
    }

    return () => {
      video.removeEventListener("loadedmetadata", handleReady);
      video.removeEventListener("error", handleError);
      video.textTracks?.removeEventListener("addtrack", handleAddTrack);
      video.textTracks?.removeEventListener("removetrack", syncNativeTracks);
      video.textTracks?.removeEventListener("change", syncNativeTracks);
      hlsRef.current = null;
      if (hls) {
        hls.destroy();
      }
      video.removeAttribute("src");
      video.load();
    };
  }, [activeSrc, autoPlay, fallbackSrc, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ready || !seekRequest) return;
    if (appliedSeekRef.current === seekRequest) return;
    const seconds = Number(seekRequest.seconds);
    if (!Number.isFinite(seconds) || seconds < 0) return;
    try {
      video.currentTime = seconds;
      appliedSeekRef.current = seekRequest;
      video.play()?.catch(() => {});
    } catch (error) {
      callbacksRef.current.onError?.(error);
    }
  }, [ready, seekRequest]);

  const selectSubtitle = (event) => {
    const id = Number(event.target.value);
    if (id >= 0) callbacksRef.current.onSubtitlesUnavailable?.(false);
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = id;
    } else {
      const tracks = Array.from(videoRef.current?.textTracks || []).filter(
        track => track.kind === "subtitles" || track.kind === "captions"
      );
      tracks.forEach((track, index) => { track.mode = index === id ? "showing" : "disabled"; });
    }
    setSelectedSubtitle(id);
  };

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        title={title}
        poster={poster || undefined}
        autoPlay={autoPlay}
        controls
        playsInline
        preload="metadata"
        className={className}
      />
      {subtitleTracks.length ? (
        <label className="absolute left-12 top-3 z-10 max-w-[50%] rounded-lg bg-black/80 px-2 py-1 text-xs font-semibold text-white">
          <span className="sr-only">{subtitlesLabel}</span>
          <select
            aria-label={subtitlesLabel}
            value={selectedSubtitle}
            onChange={selectSubtitle}
            className="min-h-[36px] max-w-full cursor-pointer bg-transparent text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <option value={-1} className="bg-slate-900">{subtitlesLabel}: {subtitlesOffLabel}</option>
            {subtitleTracks.map(track => (
              <option key={track.id} value={track.id} className="bg-slate-900">{track.label || `${subtitlesLabel} ${track.id + 1}`}</option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
