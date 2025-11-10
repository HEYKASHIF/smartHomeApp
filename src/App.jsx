import React, { useEffect, useMemo, useState } from 'react'

/**
 * SmartHome_Manager – L1 (Tailwind INLINE v2)
 * - 100% inline Tailwind classes (no custom .card/.btn layers)
 * - Auth, Rooms/Devices, Dashboard, Routines, Energy, Alerts, Logs
 * - Controlled RoomAdd (visible button) + Enter key
 * - LocalStorage persistence
 */

// Utils & constants
const uid = () => Math.random().toString(36).slice(2, 9);
const STORAGE_KEY = 'smarthome_l1_tailwind_inline_v2';
const WATT = { lamp: 10, fan: 60, thermostat: 1200 };
const DEVICE_TYPES = [
  { type: 'lamp', label: 'Lamp', defaults: { brightness: 50 } },
  { type: 'fan', label: 'Fan', defaults: { speed: 'Medium' } },
  { type: 'thermostat', label: 'Thermostat', defaults: { temperature: 24 } },
];
const clamp = (n,min,max) => Math.max(min, Math.min(max, n));
const safeNum = (v, def=0) => { const n = Number(v); return Number.isFinite(n)?n:def; };
const load = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null } catch { return null } };
const save = (d) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch {} };

export default function App(){
  const boot = load();
  const [users, setUsers] = useState(()=>boot?.users || []);
  const [currentUserId, setCurrentUserId] = useState(()=>boot?.currentUserId || null);
  const [state, setState] = useState(()=> ({
    rooms: boot?.state?.rooms || [],
    devices: (boot?.state?.devices || []).map(coerceDevice),
    routines: boot?.state?.routines || [],
    logs: boot?.state?.logs || [],
    alerts: boot?.state?.alerts || [],
    _lastRoutineMinute: boot?.state?._lastRoutineMinute || null,
  }));

  useEffect(()=>{ save({ users, currentUserId, state }); }, [users, currentUserId, state]);

  const currentUser = useMemo(()=> users.find(u=>u.id===currentUserId) || null, [users, currentUserId]);

  // Tick: energy + alerts + routines
  useEffect(()=>{
    const id = setInterval(()=>{
      setState(prev=>{
        const now = Date.now();
        let changed = false;
        const devices = prev.devices.map(d=>({ ...d }));

        for(const d of devices){
          if(d.power === 'On' && typeof d._lastEnergyTs === 'number'){
            const ms = now - d._lastEnergyTs;
            if(ms>0){
              const watt = Number.isFinite(d.watt) ? d.watt : (WATT[d.type]||100);
              d.energyKWh = (Number(d.energyKWh)||0) + (watt/1000)*(ms/3600000);
              d._lastEnergyTs = now; changed = true;
            }
          }
          if(d.power === 'On' && typeof d._onSince === 'number' && !d._alerted){
            if(now - d._onSince > 24*3600000){
              prev.alerts = [...prev.alerts, { id: uid(), ts: now, message: `${d.name} is On for over 24 hours. Consider turning it Off or resetting.` }];
              d._alerted = true; changed = true;
            }
          }
        }

        const thisMin = Math.floor(now/60000);
        if(thisMin !== prev._lastRoutineMinute && prev.routines.length){
          const hh = new Date(now).getHours();
          const mm = new Date(now).getMinutes();
          for(const r of prev.routines){
            const [rh, rm] = String(r.time||'00:00').split(':').map(x=>Number(x)||0);
            if(rh===hh && rm===mm){
              runRoutine(devices, r);
              prev.logs = [...prev.logs, { ts: now, type: 'routine', message: `Routine '${r.name}' executed` }];
              changed = true;
            }
          }
        }

        if(!changed && thisMin === prev._lastRoutineMinute) return { ...prev, _lastRoutineMinute: thisMin };
        return { ...prev, devices, _lastRoutineMinute: thisMin };
      });
    }, 1000);
    return ()=>clearInterval(id);
  }, []);

  // Auth
  function register(name, email, password){
    if(users.some(u=>u.email===email)) throw new Error('Email already exists');
    const u = { id: uid(), name: String(name||'User'), email, password };
    setUsers(p=>[...p,u]); setCurrentUserId(u.id);
  }
  function login(email, password){
    const u = users.find(u=>u.email===email && u.password===password);
    if(!u) throw new Error('Invalid credentials');
    setCurrentUserId(u.id);
  }
  function logout(){ setCurrentUserId(null); }
  function resetAll(){ localStorage.removeItem(STORAGE_KEY); setUsers([]); setCurrentUserId(null); setState({ rooms:[], devices:[], routines:[], logs:[], alerts:[], _lastRoutineMinute:null }); }

  // Domain
  function addRoom(name){
    const nm = String(name||'').trim(); if(!nm) return;
    setState(p=>({...p, rooms:[...p.rooms,{id:uid(), name:nm}]}));
  }
  function removeRoom(id){
    setState(p=>({...p, rooms:p.rooms.filter(r=>r.id!==id), devices:p.devices.filter(d=>d.roomId!==id)}));
  }

  function addDevice(roomId, type, name, rawFeatures={}, watt){
    const room = state.rooms.find(r=>r.id===roomId);
    const tpl = DEVICE_TYPES.find(t=>t.type===type);
    if(!room) throw new Error('Select a valid room');
    if(!tpl) throw new Error('Select a valid device type');

    const safeWattVal = (()=>{ const n = Number(watt); return Number.isFinite(n) && n>0 ? n : (WATT[type]||100); })();

    let features = { ...tpl.defaults };
    if(type==='lamp'){
      const b = clamp(Number(rawFeatures.brightness || features.brightness),0,100);
      features.brightness = b;
    }
    if(type==='fan'){
      const s = ['Low','Medium','High'].includes(rawFeatures.speed) ? rawFeatures.speed : 'Medium';
      features.speed = s;
    }
    if(type==='thermostat'){
      const t = clamp(Number(rawFeatures.temperature || features.temperature),16,32);
      features.temperature = t;
    }

    const d = { id: uid(), roomId: room.id, type: tpl.type, name: String(name||tpl.label), power: 'Off', features, watt: safeWattVal, energyKWh: 0, _lastEnergyTs: null, _onSince: null, _alerted: false };
    setState(p=>({...p, devices:[...p.devices, d]}));
  }

  function togglePower(id, to){
    setState(p=>{
      const now = Date.now();
      const devices = p.devices.map(d=>({ ...d }));
      const d = devices.find(x=>x.id===id); if(!d) return p;
      const next = (to==='On'?'On':'Off');
      if(next==='On' && d.power!=='On'){ d._lastEnergyTs=now; d._onSince=now; d.power='On'; }
      else if(next==='Off' && d.power==='On'){
        const ms = now - (d._lastEnergyTs ?? now);
        const watt = Number.isFinite(d.watt)?d.watt:(WATT[d.type]||100);
        d.energyKWh = (Number(d.energyKWh)||0) + (watt/1000)*(ms/3600000);
        d._lastEnergyTs=null; d._onSince=null; d._alerted=false; d.power='Off';
      } else { d.power = next; }
      p.logs = [...p.logs, { ts: now, type: 'device', message: `${d.name} -> ${next}` }];
      return { ...p, devices };
    });
  }

  function setFeature(id, key, value){
    setState(p=>{
      const devices = p.devices.map(d=>({ ...d }));
      const dev = devices.find(d=>d.id===id); if(!dev) return p;
      if(dev.type==='lamp' && key==='brightness') dev.features.brightness = clamp(Number(value),0,100);
      if(dev.type==='fan' && key==='speed') dev.features.speed = ['Low','Medium','High'].includes(value)?value:'Medium';
      if(dev.type==='thermostat' && key==='temperature') dev.features.temperature = clamp(Number(value),16,32);
      return { ...p, devices };
    });
  }

  function addRoutine(name, time, target, targetValue, to){
    const nm = String(name||'').trim(); const tm = String(time||'').trim(); if(!nm || !/^\d{2}:\d{2}$/.test(tm)) return;
    const t = (target==='room'||target==='type')?target:'all';
    let tv = targetValue; if(t==='room' && !state.rooms.find(r=>r.id===tv)) tv=undefined; if(t==='type' && !DEVICE_TYPES.find(x=>x.type===tv)) tv=undefined;
    setState(p=>({...p, routines:[...p.routines, { id:uid(), name:nm, time:tm, target:t, targetValue:tv, to:(to==='On'?'On':'Off') }]}));
  }
  function removeRoutine(id){ setState(p=>({...p, routines:p.routines.filter(r=>r.id!==id)})); }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">🏠 SmartHome_Manager (L1 • Tailwind Inline)</h1>
          <div className="flex items-center gap-2">
            {currentUser ? (<><span className="text-sm">{currentUser.name}</span><button className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm bg-slate-50 hover:bg-slate-100" onClick={logout}>Logout</button></>) : null}
            <button className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm bg-rose-600 text-white hover:bg-rose-700 border-transparent" onClick={resetAll}>Reset Data</button>
          </div>
        </header>

        {!currentUser ? (
          <Auth onRegister={register} onLogin={login} />
        ) : (
          <Main state={state}
                addRoom={addRoom} removeRoom={removeRoom}
                addDevice={addDevice} togglePower={togglePower}
                setFeature={setFeature}
                addRoutine={addRoutine} removeRoutine={removeRoutine}/>
        )}
      </div>
    </div>
  )
}

function Main({ state, addRoom, removeRoom, addDevice, togglePower, setFeature, addRoutine, removeRoutine }){
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Household rooms={state.rooms} devices={state.devices}
                   addRoom={addRoom} removeRoom={removeRoom}
                   addDevice={addDevice} togglePower={togglePower} setFeature={setFeature}/>
        <Dashboard rooms={state.rooms} devices={state.devices} togglePower={togglePower} setFeature={setFeature}/>
        <Routines rooms={state.rooms} routines={state.routines} addRoutine={addRoutine} removeRoutine={removeRoutine}/>
      </div>
      <div className="space-y-6">
        <Energy devices={state.devices}/>
        <Alerts alerts={state.alerts}/>
        <Logs logs={state.logs}/>
      </div>
    </div>
  )
}

function Auth({ onRegister, onLogin }){
  const [tab, setTab] = useState('login');
  const [err, setErr] = useState('');
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow">
      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Authentication</h2>
        <div className="flex gap-2">
          <button className={`inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm ${tab==='login'?'bg-blue-600 text-white border-transparent hover:bg-blue-700':'bg-slate-50 hover:bg-slate-100'}`} onClick={()=>setTab('login')}>Login</button>
          <button className={`inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm ${tab==='register'?'bg-blue-600 text-white border-transparent hover:bg-blue-700':'bg-slate-50 hover:bg-slate-100'}`} onClick={()=>setTab('register')}>Register</button>
        </div>
      </div>
      <div className="p-4">
        {err && <div className="text-amber-700 mb-2 text-sm">{err}</div>}
        {tab==='login' ? (
          <form onSubmit={(e)=>{ e.preventDefault(); const f=new FormData(e.currentTarget); try{ onLogin(f.get('email'), f.get('password')); }catch(ex){ setErr(ex.message) } }} className="space-y-3">
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Email</label>
              <input name="email" className="border rounded-lg px-3 py-2 w-full" required/>
            </div>
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Password</label>
              <input name="password" type="password" className="border rounded-lg px-3 py-2 w-full" required/>
            </div>
            <button className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm bg-blue-600 text-white border-transparent hover:bg-blue-700">Login</button>
          </form>
        ) : (
          <form onSubmit={(e)=>{ e.preventDefault(); const f=new FormData(e.currentTarget); try{ onRegister(f.get('name'), f.get('email'), f.get('password')); }catch(ex){ setErr(ex.message) } }} className="space-y-3">
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Name</label>
              <input name="name" className="border rounded-lg px-3 py-2 w-full" required/>
            </div>
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Email</label>
              <input name="email" className="border rounded-lg px-3 py-2 w-full" required/>
            </div>
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Password</label>
              <input name="password" type="password" className="border rounded-lg px-3 py-2 w-full" required/>
            </div>
            <button className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm bg-blue-600 text-white border-transparent hover:bg-blue-700">Create Account</button>
          </form>
        )}
      </div>
    </div>
  )
}

function Household({ rooms, devices, addRoom, removeRoom, addDevice, togglePower, setFeature }){
  const [selType, setSelType] = useState('lamp');
  const [error, setError] = useState('');
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow">
      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Household Setup</h2>
        <span className="text-sm text-slate-600">{rooms.length} rooms • {devices.length} devices</span>
      </div>
      <div className="p-4">
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-white border border-slate-200 rounded-2xl shadow">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-semibold">Rooms</h3>
                <span className="text-xs text-slate-500">Manage</span>
              </div>
              <div className="p-4 space-y-3">
                <ul className="space-y-2">
                  {rooms.map(r=> (
                    <li key={r.id} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg">
                      <span className="truncate">{r.name}</span>
                      <button className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm bg-slate-50 hover:bg-slate-100" onClick={()=>removeRoom(r.id)}>Delete</button>
                    </li>
                  ))}
                  {rooms.length===0 && <li className="text-sm text-slate-500">No rooms yet.</li>}
                </ul>
                <RoomAdd onAdd={addRoom}/>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <DeviceCreate
              rooms={rooms}
              selType={selType}
              setSelType={setSelType}
              addDevice={addDevice}
              devices={devices}
              togglePower={togglePower}
              setFeature={setFeature}
              error={error}
              setError={setError}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function RoomAdd({ onAdd }){
  const [roomName, setRoomName] = useState('');
  const canAdd = roomName.trim().length > 0;
  function handleAdd(){
    const nm = roomName.trim(); if(!nm) return;
    onAdd(nm); setRoomName('');
  }
  return (
    <div className="space-y-2">
      <label className="text-xs text-slate-600" htmlFor="roomName">Add room</label>
      <div className="flex gap-2">
        <input id="roomName" className="border rounded-lg px-3 py-2 w-full" value={roomName}
               onChange={(e)=>setRoomName(e.target.value)}
               onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); handleAdd(); } }}
               placeholder="e.g., Bedroom"/>
        <button type="button"
                onClick={handleAdd}
                disabled={!canAdd}
                className={`inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm ${canAdd? 'bg-green-600 text-white border-transparent hover:bg-green-700':'bg-slate-50 text-slate-400 cursor-not-allowed'}`}>
          ➕ Add
        </button>
      </div>
    </div>
  )
}

function DeviceCreate({ rooms, selType, setSelType, addDevice, devices, togglePower, setFeature, error, setError }){
  const hasRooms = rooms.length>0;
  const presets = ['lamp','fan','thermostat'];

  function onCreate(e){
    e.preventDefault(); const f=new FormData(e.currentTarget); setError('');
    try{
      addDevice(
        f.get('roomId'),
        f.get('type'),
        f.get('name'),
        { brightness: f.get('feat:brightness'), speed: f.get('feat:speed'), temperature: f.get('feat:temperature') },
        f.get('watt')
      );
      const t = selType; e.currentTarget.reset(); setSelType(t);
    }catch(ex){ setError(ex.message || 'Failed to create device'); }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow">
      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
        <h3 className="font-semibold">Create Device</h3>
        <div className="flex gap-2">
          {presets.map(p=>(
            <button key={p} type="button" className={`inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm ${selType===p?'bg-slate-900 text-white border-transparent':'bg-slate-50 hover:bg-slate-100'}`} onClick={()=>setSelType(p)}>
              {DEVICE_TYPES.find(t=>t.type===p).label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        {error && <div className="text-amber-700 mb-3">{error}</div>}
        {!hasRooms && <div className="text-amber-700 mb-3">Add a room first.</div>}

        <form className="grid sm:grid-cols-2 md:grid-cols-3 gap-4" onSubmit={onCreate}>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600">Room <span className="text-rose-600">*</span></label>
            <select name="roomId" className="border rounded-lg px-3 py-2 w-full bg-white" required disabled={!hasRooms}>
              <option value="">Select room…</option>
              {rooms.map(r=> <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600">Type <span className="text-rose-600">*</span></label>
            <select name="type" className="border rounded-lg px-3 py-2 w-full bg-white" value={selType} onChange={(e)=>setSelType(e.target.value)} required>
              {DEVICE_TYPES.map(t=> <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600">Name</label>
            <input name="name" className="border rounded-lg px-3 py-2 w-full" placeholder="e.g., Smart Lamp"/>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600">Watt (optional)</label>
            <input name="watt" type="number" min="1" className="border rounded-lg px-3 py-2 w-full" placeholder="e.g., 10"/>
          </div>

          {selType==='lamp' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600">Brightness (0–100)</label>
              <input name="feat:brightness" type="number" min={0} max={100} className="border rounded-lg px-3 py-2 w-full" placeholder="e.g., 80"/>
            </div>
          )}
          {selType==='fan' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600">Speed</label>
              <select name="feat:speed" className="border rounded-lg px-3 py-2 w-full bg-white"><option>Low</option><option>Medium</option><option>High</option></select>
            </div>
          )}
          {selType==='thermostat' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600">Temperature (°C)</label>
              <input name="feat:temperature" type="number" min={16} max={32} className="border rounded-lg px-3 py-2 w-full" placeholder="e.g., 24"/>
            </div>
          )}

          <div className="sm:col-span-2 md:col-span-3 flex justify-end">
            <button className="inline-flex items-center justify-center rounded-lg border px-4 py-2 text-sm bg-blue-600 text-white border-transparent hover:bg-blue-700" disabled={!hasRooms}>Create Device</button>
          </div>
        </form>

        <h4 className="font-semibold mt-6 mb-2">Devices</h4>
        <div className="grid md:grid-cols-2 gap-3">
          {devices.map(d=> (
            <div key={d.id} className="p-3 rounded-xl border border-slate-200">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{d.name} <span className="text-xs text-slate-500">({d.type})</span></div>
                  <div className="text-xs text-slate-500">Room: {rooms.find(r=>r.id===d.roomId)?.name || '—'}</div>
                </div>
                <select value={d.power} onChange={e=>togglePower(d.id, e.target.value)} className="border rounded-lg px-3 py-2 w-24 bg-white">
                  <option>Off</option><option>On</option>
                </select>
              </div>
              <div className="mt-3 flex gap-2 items-center flex-wrap">
                {d.type==='lamp' && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500">Brightness</span>
                    <input type="number" min={0} max={100} value={safeNum(d.features.brightness,50)} onChange={e=>setFeature(d.id, 'brightness', e.target.value)} className="border rounded-lg px-2 py-1 w-20" />
                  </div>
                )}
                {d.type==='fan' && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500">Speed</span>
                    <select value={['Low','Medium','High'].includes(d.features.speed)?d.features.speed:'Medium'} onChange={e=>setFeature(d.id,'speed',e.target.value)} className="border rounded-lg px-2 py-1 bg-white">
                      <option>Low</option><option>Medium</option><option>High</option>
                    </select>
                  </div>
                )}
                {d.type==='thermostat' && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500">Temp</span>
                    <input type="number" min={16} max={32} value={safeNum(d.features.temperature,24)} onChange={e=>setFeature(d.id,'temperature', e.target.value)} className="border rounded-lg px-2 py-1 w-20" />
                  </div>
                )}
                <span className="ml-auto text-xs text-slate-500">Watt: {Number.isFinite(d.watt)?d.watt:(WATT[d.type]||100)}</span>
              </div>
            </div>
          ))}
          {devices.length===0 && (<div className="text-sm text-slate-500">No devices yet. Create one above.</div>)}
        </div>
      </div>
    </div>
  )
}

function Dashboard({ rooms, devices, togglePower, setFeature }){
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow">
      <div className="p-4 border-b border-slate-200 flex items-center justify-between"><h2 className="text-lg font-semibold">Appliance Dashboard</h2><span className="text-sm text-slate-600">{devices.length} total</span></div>
      <div className="p-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Device</th>
              <th className="py-2">Room</th>
              <th className="py-2">State</th>
              <th className="py-2">Controls</th>
              <th className="py-2">Energy (kWh)</th>
            </tr>
          </thead>
          <tbody>
            {devices.map(d=> (
              <tr key={d.id} className="border-b">
                <td className="py-2 font-medium">{d.name} <span className="text-xs text-slate-500">({d.type})</span></td>
                <td className="py-2">{rooms.find(r=>r.id===d.roomId)?.name || '—'}</td>
                <td className="py-2">{d.power}</td>
                <td className="py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={d.power} onChange={e=>togglePower(d.id, e.target.value)} className="border rounded-lg px-2 py-1 w-24 bg-white">
                      <option>Off</option><option>On</option>
                    </select>
                    {d.type==='lamp' && (<input type="number" min={0} max={100} value={safeNum(d.features.brightness,50)} onChange={e=>setFeature(d.id,'brightness', e.target.value)} className="border rounded-lg px-2 py-1 w-20" />)}
                    {d.type==='fan' && (<select value={['Low','Medium','High'].includes(d.features.speed)?d.features.speed:'Medium'} onChange={e=>setFeature(d.id,'speed', e.target.value)} className="border rounded-lg px-2 py-1 bg-white"><option>Low</option><option>Medium</option><option>High</option></select>)}
                    {d.type==='thermostat' && (<input type="number" min={16} max={32} value={safeNum(d.features.temperature,24)} onChange={e=>setFeature(d.id,'temperature', e.target.value)} className="border rounded-lg px-2 py-1 w-20" />)}
                  </div>
                </td>
                <td className="py-2">{safeNum(d.energyKWh,0).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Routines({ rooms, routines, addRoutine, removeRoutine }){
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow">
      <div className="p-4 border-b border-slate-200 flex items-center justify-between"><h2 className="text-lg font-semibold">Routines</h2><span className="text-sm text-slate-600">{routines.length} total</span></div>
      <div className="p-4">
        <form className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end" onSubmit={(e)=>{ e.preventDefault(); const f = new FormData(e.currentTarget); const target=f.get('target'); let tv=f.get('targetValue'); addRoutine(f.get('name'), f.get('time'), target, tv||undefined, f.get('to')); e.currentTarget.reset(); }}>
          <input name="name" placeholder="Name (e.g., Sleep)" className="border rounded-lg px-3 py-2 w-full" required />
          <input name="time" type="time" className="border rounded-lg px-3 py-2 w-full" required />
          <select name="target" className="border rounded-lg px-3 py-2 w-full bg-white">
            <option value="all">All</option>
            <option value="room">Room</option>
            <option value="type">Type</option>
          </select>
          <select name="targetValue" className="border rounded-lg px-3 py-2 w-full bg-white">
            <option value="">(Room/Type)</option>
            {rooms.map(r=> <option key={r.id} value={r.id}>Room: {r.name}</option>)}
            {DEVICE_TYPES.map(t=> <option key={t.type} value={t.type}>Type: {t.label}</option>)}
          </select>
          <select name="to" className="border rounded-lg px-3 py-2 w-full bg-white"><option>Off</option><option>On</option></select>
          <div className="col-span-full"><button className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm bg-blue-600 text-white border-transparent hover:bg-blue-700">Add Routine</button></div>
        </form>

        <ul className="mt-3 space-y-2">
          {routines.map(r=> (
            <li key={r.id} className="flex items-center justify-between bg-slate-50 p-2 rounded">
              <div>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-slate-600">Time: {r.time} • Target: {r.target} {r.targetValue?`(${r.targetValue})`:''} → {r.to}</div>
              </div>
              <button className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm bg-slate-50 hover:bg-slate-100" onClick={()=>removeRoutine(r.id)}>Delete</button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Energy({ devices }){
  const total = devices.reduce((s,d)=>s+safeNum(d.energyKWh,0),0);
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow">
      <div className="p-4 border-b border-slate-200"><h2 className="text-lg font-semibold">Energy Usage (Simulated)</h2></div>
      <div className="p-4">
        <div className="text-sm mb-2">Total: <b>{total.toFixed(3)} kWh</b></div>
        <div className="space-y-1 text-sm">
          {devices.map(d=> (<div key={d.id} className="flex items-center justify-between"><span>{d.name}</span><span>{safeNum(d.energyKWh,0).toFixed(3)} kWh</span></div>))}
          {devices.length===0 && <div className="text-sm text-slate-500">No devices yet.</div>}
        </div>
        <p className="text-xs text-slate-500 mt-2">Tip: Devices consume energy only while <b>On</b>.</p>
      </div>
    </section>
  )
}

function Alerts({ alerts }){
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow">
      <div className="p-4 border-b border-slate-200"><h2 className="text-lg font-semibold">Alerts</h2></div>
      <div className="p-4">
        {!alerts || alerts.length===0 ? (
          <div className="text-sm text-slate-600">No alerts yet.</div>
        ) : (
          <ul className="space-y-2">
            {alerts.map(a=> (
              <li key={a.id} className="bg-yellow-50 border border-yellow-200 p-2 rounded">
                <div className="text-sm">{a.message}</div>
                <div className="text-xs text-slate-600">{new Date(a.ts).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function Logs({ logs }){
  const last = [...(logs||[])].slice(-40).reverse();
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow">
      <div className="p-4 border-b border-slate-200"><h2 className="text-lg font-semibold">Recent Activity</h2></div>
      <div className="p-4 max-h-60 overflow-auto text-xs space-y-1">
        {last.length===0 ? <div className="text-slate-500">No activity yet.</div> : last.map((l,i)=> (
          <div key={i} className="flex items-center gap-2">
            <span className="text-slate-500">{new Date(l.ts).toLocaleString()}</span>
            <span className="px-2 py-0.5 rounded bg-slate-200">{l.type}</span>
            <span>{l.message}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// helpers
function coerceDevice(d){
  const typeOk = DEVICE_TYPES.some(t=>t.type===d.type);
  const type = typeOk?d.type:'lamp';
  const watt = Number.isFinite(d?.watt) && d.watt>0 ? d.watt : (WATT[type]||100);
  const power = d?.power==='On' || d?.power==='Off' ? d.power : 'Off';
  const features = { ...(DEVICE_TYPES.find(t=>t.type===type)?.defaults||{}), ...(d?.features||{}) };
  if(type==='lamp') features.brightness = clamp(Number(features.brightness||50),0,100);
  if(type==='fan') features.speed = ['Low','Medium','High'].includes(features.speed)?features.speed:'Medium';
  if(type==='thermostat') features.temperature = clamp(Number(features.temperature||24),16,32);
  return { id: d.id||uid(), roomId: d.roomId, type, name: String(d.name||DEVICE_TYPES.find(t=>t.type===type)?.label||'Device'), power, features, watt,
    energyKWh: safeNum(d.energyKWh,0), _lastEnergyTs: d._lastEnergyTs ?? null, _onSince: d._onSince ?? null, _alerted: !!d._alerted };
}
function runRoutine(devicesDraft, r){
  const to = r.to==='On'?'On':'Off';
  const pred = r.target==='room' && r.targetValue
    ? (d)=>d.roomId===r.targetValue
    : r.target==='type' && r.targetValue
      ? (d)=>d.type===r.targetValue
      : ()=>true;
  for(const d of devicesDraft){ if(pred(d)) applyPower(d, to); }
}
function applyPower(d, to){
  const now = Date.now();
  if(to==='On' && d.power!=='On'){ d._lastEnergyTs=now; d._onSince=now; d.power='On'; return; }
  if(to!=='On' && d.power==='On'){
    const ms = now - (d._lastEnergyTs ?? now);
    const watt = Number.isFinite(d.watt)?d.watt:(WATT[d.type]||100);
    d.energyKWh = (Number(d.energyKWh)||0) + (watt/1000)*(ms/3600000);
    d._lastEnergyTs=null; d._onSince=null; d._alerted=false; d.power=to; return;
  }
  d.power = to;
}
