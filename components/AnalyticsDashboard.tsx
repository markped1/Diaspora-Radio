import React, { useState, useEffect } from 'react';
import { fetchAnalytics, AnalyticsSnapshot } from '../services/analyticsService';

const AnalyticsDashboard: React.FC = () => {
  const [data, setData] = useState<AnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const snap = await fetchAnalytics();
    setData(snap);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const topCountries = data
    ? Object.entries(data.countries).sort((a, b) => b[1] - a[1]).slice(0, 8)
    : [];

  const regionLabels: Record<string, string> = {
    AF: '🌍 Africa', EU: '🌍 Europe', NA: '🌎 N. America',
    SA: '🌎 S. America', AS: '🌏 Asia', OC: '🌏 Oceania', AN: '🧊 Antarctica',
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gray-900 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-wide">Live Analytics</h2>
          <p className="text-[7px] text-gray-400 mt-0.5">
            {data ? `Updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Loading...'}
          </p>
        </div>
        <button onClick={load} className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-white hover:bg-gray-600">
          <i className={`fas fa-sync-alt text-[9px] ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Live counts */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Live Now', value: data?.totalListeners ?? 0, icon: 'fa-headphones', color: 'bg-green-500' },
          { label: 'Radio', value: data?.radioListeners ?? 0, icon: 'fa-broadcast-tower', color: 'bg-[#008751]' },
          { label: 'TV', value: data?.tvViewers ?? 0, icon: 'fa-tv', color: 'bg-red-500' },
        ].map(stat => (
          <div key={stat.label} className="bg-white rounded-2xl p-3 border border-gray-100 shadow-sm text-center">
            <div className={`w-8 h-8 ${stat.color} rounded-full flex items-center justify-center mx-auto mb-1`}>
              <i className={`fas ${stat.icon} text-white text-[9px]`} />
            </div>
            <p className="text-xl font-black text-gray-900">{stat.value}</p>
            <p className="text-[6px] font-black uppercase text-gray-400 tracking-widest">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Peak today */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <i className="fas fa-chart-line text-amber-500 text-sm" />
          <div>
            <p className="text-[7px] font-black uppercase text-amber-700 tracking-widest">Peak Today</p>
            <p className="text-[6px] text-amber-500">Highest concurrent listeners</p>
          </div>
        </div>
        <span className="text-2xl font-black text-amber-700">{data?.peakToday ?? 0}</span>
      </div>

      {/* Top countries */}
      {topCountries.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
          <h3 className="text-[7px] font-black uppercase text-gray-500 tracking-widest">Top Countries</h3>
          <div className="space-y-1.5">
            {topCountries.map(([country, count]) => {
              const max = topCountries[0][1];
              const pct = Math.round((count / max) * 100);
              return (
                <div key={country} className="space-y-0.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[8px] font-bold text-gray-700">{country}</span>
                    <span className="text-[7px] font-black text-gray-500">{count}</span>
                  </div>
                  <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-[#008751] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Regions */}
      {data && Object.keys(data.regions).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
          <h3 className="text-[7px] font-black uppercase text-gray-500 tracking-widest">By Region</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(data.regions).sort((a, b) => b[1] - a[1]).map(([region, count]) => (
              <div key={region} className="bg-gray-50 rounded-xl px-3 py-2 flex items-center justify-between">
                <span className="text-[8px] font-bold text-gray-600">{regionLabels[region] || `🌐 ${region}`}</span>
                <span className="text-[8px] font-black text-[#008751]">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data?.totalListeners === 0 && !loading && (
        <div className="bg-gray-50 rounded-2xl border border-dashed border-gray-200 p-8 text-center">
          <i className="fas fa-chart-bar text-3xl text-gray-200 mb-2 block" />
          <p className="text-[8px] font-black uppercase text-gray-400">No active listeners right now</p>
          <p className="text-[7px] text-gray-300 mt-1">Data appears when listeners tune in</p>
          <p className="text-[6px] text-gray-300 mt-2">Requires <code className="bg-gray-100 px-1 rounded">listener_sessions</code> table in Supabase</p>
        </div>
      )}
    </div>
  );
};

export default AnalyticsDashboard;
