import React from 'react';
import { X, Film, Download, ExternalLink, Play } from 'lucide-react';

interface MotionVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MotionVideoModal: React.FC<MotionVideoModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-cyan-500/30 rounded-2xl shadow-2xl shadow-cyan-500/10 overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <Film className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Delta Cryptobot • Motion Graphic Project Video
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">
                  Code-Generated Motion Graphics
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Playable interactive motion graphics presentation with audio telemetry synthesizer & direct video exporter
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/motion_graphic_video.html"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              title="Open standalone player in new tab"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Full Tab</span>
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Video Player Iframe */}
        <div className="relative w-full aspect-video bg-black">
          <iframe
            src="/motion_graphic_video.html"
            title="Motion Graphic Project Video"
            className="w-full h-full border-none"
            allow="fullscreen; autoplay"
          />
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></span>
              MP4 Render Ready (delta_cryptobot_motion_graphics.mp4)
            </span>
            <span>•</span>
            <span>Spacebar: Pause / Play</span>
            <span>•</span>
            <span>Includes 6 Scenes, DSP Waveforms & Compounding Trajectory</span>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/delta_cryptobot_motion_graphics.mp4"
              download="delta_cryptobot_motion_graphics.mp4"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-md transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download Rendered MP4</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
