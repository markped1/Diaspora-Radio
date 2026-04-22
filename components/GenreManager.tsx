import React, { useState, useEffect } from 'react';
import { MediaFile } from '../types';
import {
  Genre, GenreName, getGenres, saveGenre, deleteGenre,
  addTrackToGenre, removeTrackFromGenre, formatTimeSlot, getActiveGenre,
} from '../services/genreService';

interface GenreManagerProps {
  allTracks: MediaFile[];
  onPlayGenre: (tracks: MediaFile[]) => void;
}

const GENRE_EMOJIS: Record<string, string> = {
  Afrobeats: '🎵', Amapiano: '🎹', 'R&B': '🎤', 'Hip-Hop': '🎧',
  Gospel: '🙏', Highlife: '🎺', Reggae: '🌿', Jazz: '🎷',
  Pop: '⭐', Dancehall: '💃', Fuji: '🥁', Juju: '🎸', Soul: '❤️',
  Electronic: '🎛️', General: '🎶',
};

const GENRE_COLORS: Record<string, string> = {
  Afrobeats: '#f59e0b', Amapiano: '#8b5cf6', 'R&B': '#ec4899', 'Hip-Hop': '#3b82f6',
  Gospel: '#10b981', Highlife: '#f97316', Reggae: '#22c55e', Jazz: '#6366f1',
  Pop: '#f43f5e', Dancehall: '#14b8a6', Fuji: '#d97706', Juju: '#7c3aed',
  Soul: '#e11d48', Electronic: '#0ea5e9', General: '#6b7280',
};

const GenreManager: React.FC<GenreManagerProps> = ({ allTracks, onPlayGenre }) => {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selected, setSelected] = useState<Genre | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [activeGenre, setActiveGenre] = useState<Genre | null>(null);
  const [editSchedule, setEditSchedule] = useState(false);
  const [schedStart, setSchedStart] = useState(0);
  const [schedEnd, setSchedEnd] = useState(6);
  const [schedDays, setSchedDays] = useState<number[]>([]);

  const reload = () => {
    const g = getGenres();
    setGenres(g);
    setActiveGenre(getActiveGenre());
  };

  useEffect(() => {
    reload();
    const interval = setInterval(() => setActiveGenre(getActiveGenre()), 60000);
    return () => clearInterval(interval);
  }, []);

  const cloudTracks = allTracks.filter(t => t.type === 'audio' && t.url?.startsWith('http'));

  const handleCreateGenre = () => {
    if (!newName.trim()) return;
    const name = newName.trim() as GenreName;
    const genre: Genre = {
      id: name.toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + Date.now(),
      name,
      emoji: GENRE_EMOJIS[name] || '🎵',
      color: GENRE_COLORS[name] || '#6b7280',
      trackIds: [],
      schedule: null,
      isActive: true,
    };
    saveGenre(genre);
    setNewName('');
    setShowNew(false);
    reload();
  };

  const handleSaveSchedule = () => {
    if (!selected) return;
    const updated = {
      ...selected,
      schedule: { startHour: schedStart, endHour: schedEnd, days: schedDays },
    };
    saveGenre(updated);
    setSelected(updated);
    setEditSchedule(false);
    reload();
  };

  const handleToggleTrack = (genreId: string, trackId: string, inGenre: boolean) => {
    if (inGenre) removeTrackFromGenre(genreId, trackId);
    else addTrackToGenre(genreId, trackId);
    reload();
    if (selected?.id === genreId) {
      setSelected(getGenres().find(g => g.id === genreId) || null);
    }
  };

  const handlePlayGenre = (genre: Genre) => {
    const tracks = genre.trackIds
      .map(id => cloudTracks.find(t => t.id === id))
      .filter(Boolean) as MediaFile[];
    if (tracks.length > 0) onPlayGenre(tracks);
  };

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const fmtHour = (h: number) => `${h === 0 ? 12 : h > 12 ? h - 12 : h}:00${h < 12 ? 'am' : 'pm'}`;

  return (
    <div className="space-y-4">
      {/* Active genre banner */}
      {activeGenre && (
        <div className="rounded-2xl p-3 flex items-center justify-between shadow-sm"
          style={{ backgroundColor: activeGenre.color + '20', borderColor: activeGenre.color + '40', border: '1px solid' }}>
          <div className="flex items-center space-x-2">
            <span className="text-xl">{activeGenre.emoji}</span>
            <div>
              <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: activeGenre.color }}>
                Now Scheduled
              </p>
              <p className="text-[10px] font-black text-gray-800">{activeGenre.name}</p>
            </div>
          </div>
          <button
            onClick={() => handlePlayGenre(activeGenre)}
            disabled={activeGenre.trackIds.length === 0}
            className="px-3 py-1.5 rounded-xl text-white text-[7px] font-black uppercase disabled:opacity-40"
            style={{ backgroundColor: activeGenre.color }}
          >
            Play Now
          </button>
        </div>
      )}

      {/* Genre grid */}
      <div className="grid grid-cols-2 gap-2">
        {genres.map(genre => {
          const trackCount = genre.trackIds.filter(id => cloudTracks.find(t => t.id === id)).length;
          const isActive = activeGenre?.id === genre.id;
          return (
            <button
              key={genre.id}
              onClick={() => setSelected(genre)}
              className={`p-3 rounded-2xl border text-left transition-all active:scale-95 ${
                selected?.id === genre.id ? 'ring-2' : ''
              }`}
              style={{
                backgroundColor: genre.color + '15',
                borderColor: genre.color + '40',
                ringColor: genre.color,
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-lg">{genre.emoji}</span>
                {isActive && <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: genre.color }} />}
              </div>
              <p className="text-[9px] font-black text-gray-800 truncate">{genre.name}</p>
              <p className="text-[6px] text-gray-400">{trackCount} tracks</p>
              <p className="text-[6px] mt-0.5" style={{ color: genre.color }}>
                {formatTimeSlot(genre.schedule)}
              </p>
            </button>
          );
        })}

        {/* Add new */}
        <button
          onClick={() => setShowNew(true)}
          className="p-3 rounded-2xl border border-dashed border-gray-200 flex flex-col items-center justify-center space-y-1 text-gray-400 hover:bg-gray-50"
        >
          <i className="fas fa-plus text-lg" />
          <span className="text-[7px] font-black uppercase">New Genre</span>
        </button>
      </div>

      {/* New genre form */}
      {showNew && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2 shadow-sm">
          <h3 className="text-[8px] font-black uppercase text-gray-500">New Genre</h3>
          <select
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[9px] outline-none"
          >
            <option value="">Select genre...</option>
            {Object.keys(GENRE_EMOJIS).map(g => (
              <option key={g} value={g}>{GENRE_EMOJIS[g]} {g}</option>
            ))}
          </select>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Or type custom name..."
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[9px] outline-none"
          />
          <div className="flex space-x-2">
            <button onClick={handleCreateGenre} disabled={!newName.trim()}
              className="flex-1 bg-[#008751] text-white py-2 rounded-xl text-[7px] font-black uppercase disabled:opacity-40">
              Create
            </button>
            <button onClick={() => setShowNew(false)}
              className="px-4 bg-gray-100 text-gray-500 py-2 rounded-xl text-[7px] font-black uppercase">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Selected genre detail */}
      {selected && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="p-4 flex items-center justify-between" style={{ backgroundColor: selected.color + '15' }}>
            <div className="flex items-center space-x-2">
              <span className="text-2xl">{selected.emoji}</span>
              <div>
                <p className="text-sm font-black text-gray-900">{selected.name}</p>
                <p className="text-[6px] text-gray-500">{selected.trackIds.length} tracks assigned</p>
              </div>
            </div>
            <div className="flex space-x-1">
              <button
                onClick={() => handlePlayGenre(selected)}
                disabled={selected.trackIds.filter(id => cloudTracks.find(t => t.id === id)).length === 0}
                className="px-3 py-1.5 rounded-xl text-white text-[7px] font-black uppercase disabled:opacity-40"
                style={{ backgroundColor: selected.color }}
              >
                ▶ Play
              </button>
              <button
                onClick={() => { deleteGenre(selected.id); setSelected(null); reload(); }}
                className="w-7 h-7 bg-red-50 text-red-400 rounded-full flex items-center justify-center hover:bg-red-100"
              >
                <i className="fas fa-trash text-[7px]" />
              </button>
            </div>
          </div>

          {/* Schedule */}
          <div className="px-4 py-3 border-b border-gray-50">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[7px] font-black uppercase text-gray-400 tracking-widest">Schedule</p>
                <p className="text-[9px] font-bold text-gray-700">{formatTimeSlot(selected.schedule)}</p>
              </div>
              <button onClick={() => {
                setEditSchedule(!editSchedule);
                if (selected.schedule) {
                  setSchedStart(selected.schedule.startHour);
                  setSchedEnd(selected.schedule.endHour);
                  setSchedDays(selected.schedule.days);
                }
              }} className="text-[7px] font-black uppercase text-blue-500 hover:text-blue-700">
                {editSchedule ? 'Cancel' : 'Edit'}
              </button>
            </div>

            {editSchedule && (
              <div className="mt-3 space-y-2">
                <div className="flex space-x-2">
                  <div className="flex-1">
                    <p className="text-[6px] font-black uppercase text-gray-400 mb-1">Start</p>
                    <select value={schedStart} onChange={e => setSchedStart(Number(e.target.value))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-[8px] outline-none">
                      {hours.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <p className="text-[6px] font-black uppercase text-gray-400 mb-1">End</p>
                    <select value={schedEnd} onChange={e => setSchedEnd(Number(e.target.value))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-[8px] outline-none">
                      {hours.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <p className="text-[6px] font-black uppercase text-gray-400 mb-1">Days (empty = every day)</p>
                  <div className="flex space-x-1">
                    {days.map((d, i) => (
                      <button key={d} onClick={() => setSchedDays(prev =>
                        prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]
                      )}
                        className={`flex-1 py-1 rounded text-[6px] font-black uppercase transition-all ${
                          schedDays.includes(i) ? 'text-white' : 'bg-gray-100 text-gray-400'
                        }`}
                        style={schedDays.includes(i) ? { backgroundColor: selected.color } : {}}
                      >{d[0]}</button>
                    ))}
                  </div>
                </div>
                <button onClick={handleSaveSchedule}
                  className="w-full bg-[#008751] text-white py-2 rounded-xl text-[7px] font-black uppercase">
                  Save Schedule
                </button>
              </div>
            )}
          </div>

          {/* Track list */}
          <div className="p-4 space-y-2">
            <p className="text-[7px] font-black uppercase text-gray-400 tracking-widest">
              Assign Tracks ({cloudTracks.length} available)
            </p>
            {cloudTracks.length === 0 ? (
              <p className="text-[7px] text-gray-300 text-center py-4">Upload audio to Cloudinary first</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {cloudTracks.map(track => {
                  const inGenre = selected.trackIds.includes(track.id);
                  return (
                    <div key={track.id} className={`flex items-center justify-between p-2 rounded-xl border ${
                      inGenre ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'
                    }`}>
                      <div className="flex items-center space-x-2 truncate">
                        <i className={`fas fa-music text-[8px] ${inGenre ? 'text-green-500' : 'text-gray-300'}`} />
                        <p className="text-[8px] font-bold text-gray-700 truncate">
                          {track.name.replace(/\.(mp3|wav|m4a|aac|ogg|flac)$/i, '')}
                        </p>
                      </div>
                      <button
                        onClick={() => handleToggleTrack(selected.id, track.id, inGenre)}
                        className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[7px] font-black ${
                          inGenre ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
                        }`}
                      >
                        {inGenre ? '✓' : '+'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GenreManager;
