import React, { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard, Package, Calendar, FileText, Users, Plus, Trash2,
  X, Search, AlertTriangle, Speaker, Truck, Wrench, UserCog, ShieldCheck,
  Camera, MapPin, Fuel, LogOut, CheckCircle2, RotateCcw, ClipboardList, Mail,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import {
  useEquipment, useClients, useEvents, useQuotes, useFleet, useJourneys, useProfiles,
  equipmentApi, clientsApi, eventsApi, quotesApi, fleetApi, journeysApi, profilesApi,
} from "./db";

/* ---------- constants ---------- */

const CATEGORIES = ["Speakers", "Lighting", "Staging", "Power", "Cabling", "Microphones", "Mixing", "Other"];
const EVENT_STATUSES = ["quote", "confirmed", "completed", "cancelled"];
const QUOTE_STATUSES = ["draft", "sent", "accepted", "paid"];
const ROLES = [
  { key: "admin", label: "Admin", icon: ShieldCheck },
  { key: "staff", label: "Staff", icon: Users },
  { key: "warehouse", label: "Warehouse Manager", icon: Package },
  { key: "driver", label: "Driver", icon: Truck },
];

const fmtMoney = (n) => `$${(Math.round((n || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtKsh = (n) => `KSh ${Math.round(n || 0).toLocaleString()}`;
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const fmtDateTime = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd;
const addDays = (dateStr, n) => { const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const mapLink = (loc) => (loc ? `https://maps.google.com/?q=${loc.lat},${loc.lng}` : null);
const todayStr = () => new Date().toISOString().slice(0, 10);

/* ---------- image + AI helpers ---------- */

function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        const maxW = 640;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 8000 }
    );
  });
}

async function analyzeOdometerPhoto(dataUrl) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const response = await fetch("/.netlify/functions/analyze-odometer", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ photo: dataUrl }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Couldn't check the photo");
  return json;
}

/* ---------- small UI atoms ---------- */

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="hs-modal-backdrop" onClick={onClose}>
      <div className={`hs-modal ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="hs-modal-head"><span className="hs-eyebrow">{title}</span><button className="hs-icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="hs-modal-body">{children}</div>
      </div>
    </div>
  );
}
function StatusPill({ status }) { return <span className={`hs-pill hs-pill-${status}`}>{status}</span>; }
function Field({ label, children }) { return (<label className="hs-field"><span>{label}</span>{children}</label>); }

/* ---------- Odometer capture ---------- */

function OdometerCapture({ label, onDone, onCancel }) {
  const [step, setStep] = useState("idle");
  const [photo, setPhoto] = useState(null);
  const [reason, setReason] = useState("");
  const [reading, setReading] = useState("");
  const [manual, setManual] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setStep("checking");
    try {
      const dataUrl = await downscaleImage(file);
      setPhoto(dataUrl);
      const result = await analyzeOdometerPhoto(dataUrl);
      if (result.clear) { setReading(result.reading != null ? String(result.reading) : ""); setStep("clear"); }
      else { setReason(result.reason || "Photo isn't clear enough to read."); setStep("unclear"); }
    } catch {
      setReason("Couldn't check the photo automatically. You can retake it, or enter the reading manually.");
      setStep("error");
    }
  };

  const confirm = async () => {
    const loc = await getLocation();
    onDone({ photo, reading: reading ? Number(reading) : null, location: loc });
  };

  return (
    <div className="hs-odo">
      <p className="hs-muted" style={{ marginTop: 0 }}>{label}</p>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleFile} />
      {step === "idle" && <button className="hs-btn primary" onClick={() => inputRef.current.click()}><Camera size={16} /> Take Odometer Photo</button>}
      {step === "checking" && (
        <div className="hs-odo-preview">{photo && <img src={photo} alt="odometer" />}<p className="hs-muted">Checking the photo is clear...</p></div>
      )}
      {(step === "unclear" || step === "error") && (
        <div className="hs-odo-preview">
          {photo && <img src={photo} alt="odometer" className="rejected" />}
          <p className="hs-danger-text">{reason}</p>
          <div className="hs-modal-actions" style={{ justifyContent: "flex-start" }}>
            <button className="hs-btn primary" onClick={() => { setStep("idle"); setPhoto(null); }}><RotateCcw size={14} /> Retake Photo</button>
            {step === "error" && <button className="hs-btn" onClick={() => { setManual(true); setStep("clear"); }}>Enter reading manually</button>}
          </div>
        </div>
      )}
      {step === "clear" && (
        <div className="hs-odo-preview">
          {photo && <img src={photo} alt="odometer" className="accepted" />}
          {!manual && <span className="hs-mono hs-accent-text"><CheckCircle2 size={14} style={{ verticalAlign: "-2px" }} /> Photo is clear</span>}
          <Field label="Odometer Reading (miles)"><input type="number" value={reading} onChange={(e) => setReading(e.target.value)} placeholder="e.g. 48213" /></Field>
          <div className="hs-modal-actions"><button className="hs-btn" onClick={onCancel}>Cancel</button><button className="hs-btn primary" onClick={confirm} disabled={!reading}>Confirm</button></div>
        </div>
      )}
    </div>
  );
}

/* ================= ADMIN: Dashboard ================= */

function Dashboard({ equipment, events, clients, quotes, goTo }) {
  const today = todayStr();
  const upcoming = events.filter((e) => e.status !== "cancelled" && e.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 5);
  const lowStock = equipment.filter((item) => {
    const soon = events.filter((e) => e.status !== "cancelled" && e.startDate <= addDays(today, 14) && e.endDate >= today);
    const bookedSoon = soon.reduce((s, e) => { const l = e.equipment.find((x) => x.itemId === item.id); return s + (l ? l.qty : 0); }, 0);
    const physicallyOut = item.qtyOut + item.qtyRepair + item.qtyMissing;
    return bookedSoon + physicallyOut > item.totalQty * 0.7;
  }).slice(0, 5);
  const pendingQuotes = quotes.filter((q) => q.status === "sent" || q.status === "draft").length;
  const revenueOutstanding = quotes.filter((q) => q.status === "sent" || q.status === "accepted").reduce((s, q) => s + quoteTotal(q), 0);

  return (
    <div>
      <div className="hs-stat-row">
        <div className="hs-stat-card" onClick={() => goTo("schedule")}><span className="hs-stat-num">{events.filter((e) => e.status !== "cancelled").length}</span><span className="hs-stat-label">Active Events</span></div>
        <div className="hs-stat-card" onClick={() => goTo("inventory")}><span className="hs-stat-num">{equipment.reduce((s, e) => s + e.totalQty, 0)}</span><span className="hs-stat-label">Units in Inventory</span></div>
        <div className="hs-stat-card" onClick={() => goTo("quotes")}><span className="hs-stat-num">{pendingQuotes}</span><span className="hs-stat-label">Quotes Pending</span></div>
        <div className="hs-stat-card accent" onClick={() => goTo("quotes")}><span className="hs-stat-num">{fmtMoney(revenueOutstanding)}</span><span className="hs-stat-label">Outstanding</span></div>
      </div>
      <div className="hs-dash-grid">
        <div className="hs-panel">
          <div className="hs-panel-head"><span className="hs-eyebrow">On The Books</span></div>
          {upcoming.length === 0 && <p className="hs-muted">Nothing scheduled yet.</p>}
          {upcoming.map((e) => {
            const client = clients.find((c) => c.id === e.clientId);
            return (
              <div key={e.id} className="hs-row" onClick={() => goTo("schedule")}>
                <div className="hs-row-main"><strong>{e.name}</strong><span className="hs-muted">{client ? client.name : "No client"} &middot; {e.venue || "No venue set"}</span></div>
                <div className="hs-row-side"><span className="hs-mono">{fmtDate(e.startDate)}</span><StatusPill status={e.status} /></div>
              </div>
            );
          })}
        </div>
        <div className="hs-panel">
          <div className="hs-panel-head"><span className="hs-eyebrow">Tight On Stock (next 14 days)</span></div>
          {lowStock.length === 0 && <p className="hs-muted">All gear clear for the next two weeks.</p>}
          {lowStock.map((item) => (
            <div key={item.id} className="hs-row" onClick={() => goTo("inventory")}>
              <div className="hs-row-main"><strong>{item.name}</strong><span className="hs-muted">{item.totalQty} total units</span></div>
              <AlertTriangle size={16} className="hs-warn-icon" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================= ADMIN: Inventory ================= */

function Inventory({ equipment }) {
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState("");
  const filtered = equipment.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()) || i.category.toLowerCase().includes(query.toLowerCase()));
  const byCategory = {};
  filtered.forEach((i) => { byCategory[i.category] = byCategory[i.category] || []; byCategory[i.category].push(i); });

  const save = async (item) => {
    if (item.id) await equipmentApi.update(item.id, item);
    else {
      const existingCount = equipment.filter((e) => e.category === item.category).length;
      await equipmentApi.add({ ...item, existingCount });
    }
    setEditing(null);
  };
  const remove = async (id) => { await equipmentApi.remove(id); };

  return (
    <div>
      <div className="hs-toolbar">
        <div className="hs-search"><Search size={16} /><input placeholder="Search gear or category..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <button className="hs-btn primary" onClick={() => setEditing({ name: "", category: CATEGORIES[0], totalQty: 1, dayRate: 0, barcode: "" })}><Plus size={16} /> Add Gear</button>
      </div>
      {Object.keys(byCategory).length === 0 && <p className="hs-muted hs-empty">No gear matches. Add your first item.</p>}
      {Object.entries(byCategory).map(([cat, items]) => (
        <div key={cat} className="hs-cat-block">
          <span className="hs-eyebrow">{cat}</span>
          <div className="hs-tag-grid">
            {items.map((item) => {
              const available = item.totalQty - item.qtyOut - item.qtyRepair - item.qtyMissing;
              return (
                <div key={item.id} className="hs-case-tag">
                  <div className="hs-case-stripe" />
                  <div className="hs-case-body">
                    <span className="hs-case-code hs-mono">{item.code}</span>
                    <strong className="hs-case-name">{item.name}</strong>
                    {item.barcode && <span className="hs-muted hs-mono">barcode: {item.barcode}</span>}
                    <div className="hs-case-meta"><span className={available <= 0 ? "hs-danger-text" : "hs-muted"}>{available <= 0 ? "None free" : `${available} / ${item.totalQty} free`}</span></div>
                    {(item.qtyOut > 0 || item.qtyRepair > 0 || item.qtyMissing > 0) && (
                      <div className="hs-badge-row">
                        {item.qtyOut > 0 && <span className="hs-badge">{item.qtyOut} out</span>}
                        {item.qtyRepair > 0 && <span className="hs-badge warn">{item.qtyRepair} repair</span>}
                        {item.qtyMissing > 0 && <span className="hs-badge danger">{item.qtyMissing} missing</span>}
                      </div>
                    )}
                  </div>
                  <div className="hs-case-actions">
                    <button className="hs-icon-btn" onClick={() => setEditing(item)}><FileText size={14} /></button>
                    <button className="hs-icon-btn danger" onClick={() => remove(item.id)}><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {editing && (
        <Modal title={editing.id ? "Edit Gear" : "Add Gear"} onClose={() => setEditing(null)}>
          <Field label="Name"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <Field label="Category"><select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
          <div className="hs-field-row">
            <Field label="Total Units"><input type="number" min="0" value={editing.totalQty} onChange={(e) => setEditing({ ...editing, totalQty: Number(e.target.value) })} /></Field>
            <Field label="Day Rate ($)"><input type="number" min="0" step="0.01" value={editing.dayRate} onChange={(e) => setEditing({ ...editing, dayRate: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Barcode"><input value={editing.barcode || ""} placeholder="Click here, then scan the tag" onChange={(e) => setEditing({ ...editing, barcode: e.target.value })} /></Field>
          <div className="hs-modal-actions"><button className="hs-btn primary" onClick={() => save(editing)} disabled={!editing.name}>Save</button></div>
        </Modal>
      )}
    </div>
  );
}

/* ================= ADMIN: Schedule ================= */

function bookedQtyFor(events, itemId, start, end, excludeEventId) {
  return events.filter((e) => e.id !== excludeEventId && e.status !== "cancelled" && overlaps(e.startDate, e.endDate, start, end))
    .reduce((sum, e) => { const l = e.equipment.find((x) => x.itemId === itemId); return sum + (l ? l.qty : 0); }, 0);
}

function Schedule({ events, equipment, clients, profiles }) {
  const [editing, setEditing] = useState(null);
  const sorted = [...events].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const staffUsers = profiles.filter((u) => u.role === "staff");

  const blank = () => ({ name: "", clientId: clients[0]?.id || "", venue: "", startDate: todayStr(), endDate: todayStr(), status: "quote", equipment: [], assignedStaff: [], notes: "" });
  const save = async (ev) => { if (ev.id) await eventsApi.update(ev.id, ev); else await eventsApi.add(ev); setEditing(null); };
  const remove = async (id) => { await eventsApi.remove(id); setEditing(null); };
  const addLine = () => { const item = equipment[0]; if (!item) return; setEditing({ ...editing, equipment: [...editing.equipment, { itemId: item.id, qty: 1 }] }); };
  const updateLine = (idx, patch) => setEditing({ ...editing, equipment: editing.equipment.map((l, i) => (i === idx ? { ...l, ...patch } : l)) });
  const removeLine = (idx) => setEditing({ ...editing, equipment: editing.equipment.filter((_, i) => i !== idx) });
  const toggleStaff = (id) => { const has = editing.assignedStaff.includes(id); setEditing({ ...editing, assignedStaff: has ? editing.assignedStaff.filter((x) => x !== id) : [...editing.assignedStaff, id] }); };

  return (
    <div>
      <div className="hs-toolbar"><span className="hs-muted">{events.filter((e) => e.status !== "cancelled").length} active events</span><button className="hs-btn primary" onClick={() => setEditing(blank())}><Plus size={16} /> New Event</button></div>
      {sorted.length === 0 && <p className="hs-muted hs-empty">No events yet. Book your first one.</p>}
      <div className="hs-timeline">
        {sorted.map((e) => {
          const client = clients.find((c) => c.id === e.clientId);
          return (
            <div key={e.id} className="hs-timeline-row" onClick={() => setEditing({ ...e })}>
              <div className="hs-timeline-date"><span className="hs-mono">{fmtDate(e.startDate)}</span>{e.endDate !== e.startDate && <span className="hs-mono hs-muted">&rarr; {fmtDate(e.endDate)}</span>}</div>
              <div className="hs-timeline-main"><strong>{e.name}</strong><span className="hs-muted">{client ? client.name : "No client"} &middot; {e.venue || "No venue"} &middot; {(e.assignedStaff || []).length} staff assigned</span></div>
              <StatusPill status={e.status} />
            </div>
          );
        })}
      </div>
      {editing && (
        <Modal title={editing.id ? "Edit Event" : "New Event"} onClose={() => setEditing(null)} wide>
          <Field label="Event Name"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <div className="hs-field-row">
            <Field label="Client"><select value={editing.clientId || ""} onChange={(e) => setEditing({ ...editing, clientId: e.target.value })}><option value="">No client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Venue"><input value={editing.venue || ""} onChange={(e) => setEditing({ ...editing, venue: e.target.value })} /></Field>
          </div>
          <div className="hs-field-row">
            <Field label="Start Date"><input type="date" value={editing.startDate} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} /></Field>
            <Field label="End Date"><input type="date" value={editing.endDate} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })} /></Field>
            <Field label="Status"><select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>{EVENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
          </div>
          <div className="hs-panel-head" style={{ marginTop: 12 }}><span className="hs-eyebrow">Gear Assigned</span><button className="hs-btn small" onClick={addLine}><Plus size={14} /> Add Line</button></div>
          {editing.equipment.length === 0 && <p className="hs-muted">No gear assigned yet.</p>}
          {editing.equipment.map((line, idx) => {
            const item = equipment.find((i) => i.id === line.itemId);
            const bookedElsewhere = item ? bookedQtyFor(events, item.id, editing.startDate, editing.endDate, editing.id) : 0;
            const available = item ? item.totalQty - bookedElsewhere : 0;
            const overbooked = line.qty > available;
            return (
              <div key={idx} className="hs-gear-line">
                <select value={line.itemId} onChange={(e) => updateLine(idx, { itemId: e.target.value })}>{equipment.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
                <input type="number" min="1" value={line.qty} style={{ width: 64 }} onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })} />
                <span className={overbooked ? "hs-danger-text hs-mono" : "hs-muted hs-mono"}>{overbooked ? `only ${available} free` : `${available} free`}</span>
                <button className="hs-icon-btn danger" onClick={() => removeLine(idx)}><Trash2 size={14} /></button>
              </div>
            );
          })}
          <div className="hs-panel-head" style={{ marginTop: 12 }}><span className="hs-eyebrow">Staff Assigned</span></div>
          {staffUsers.length === 0 && <p className="hs-muted">No staff added yet — invite them under Team.</p>}
          <div className="hs-chip-row">{staffUsers.map((u) => (<button type="button" key={u.id} className={`hs-chip ${editing.assignedStaff.includes(u.id) ? "on" : ""}`} onClick={() => toggleStaff(u.id)}>{u.name}</button>))}</div>
          <Field label="Notes"><textarea rows={2} value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
          <div className="hs-modal-actions">
            {editing.id && <button className="hs-btn danger" onClick={() => remove(editing.id)}>Delete Event</button>}
            <button className="hs-btn primary" onClick={() => save(editing)} disabled={!editing.name}>Save Event</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= ADMIN: Clients ================= */

function Clients({ clients, events }) {
  const [editing, setEditing] = useState(null);
  const save = async (c) => { if (c.id) await clientsApi.update(c.id, c); else await clientsApi.add(c); setEditing(null); };
  const remove = async (id) => { await clientsApi.remove(id); setEditing(null); };
  return (
    <div>
      <div className="hs-toolbar"><span className="hs-muted">{clients.length} client{clients.length === 1 ? "" : "s"}</span><button className="hs-btn primary" onClick={() => setEditing({ name: "", company: "", email: "", phone: "" })}><Plus size={16} /> Add Client</button></div>
      {clients.length === 0 && <p className="hs-muted hs-empty">No clients yet.</p>}
      <div className="hs-tag-grid">{clients.map((c) => (<div key={c.id} className="hs-client-card" onClick={() => setEditing(c)}><strong>{c.name}</strong><span className="hs-muted">{c.company || "Independent"}</span><span className="hs-muted hs-mono">{c.email}</span><span className="hs-muted">{events.filter((e) => e.clientId === c.id).length} event(s)</span></div>))}</div>
      {editing && (
        <Modal title={editing.id ? "Edit Client" : "Add Client"} onClose={() => setEditing(null)}>
          <Field label="Name"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <Field label="Company"><input value={editing.company || ""} onChange={(e) => setEditing({ ...editing, company: e.target.value })} /></Field>
          <div className="hs-field-row"><Field label="Email"><input value={editing.email || ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field><Field label="Phone"><input value={editing.phone || ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field></div>
          <div className="hs-modal-actions">{editing.id && <button className="hs-btn danger" onClick={() => remove(editing.id)}>Delete</button>}<button className="hs-btn primary" onClick={() => save(editing)} disabled={!editing.name}>Save</button></div>
        </Modal>
      )}
    </div>
  );
}

/* ================= ADMIN: Quotes ================= */

function quoteTotal(q) { const subtotal = q.lineItems.reduce((s, l) => s + l.qty * l.rate, 0); return subtotal + subtotal * (q.taxPercent / 100); }

function Quotes({ quotes, clients, events }) {
  const [editing, setEditing] = useState(null);
  const blank = () => ({ clientId: clients[0]?.id || "", eventId: "", lineItems: [{ desc: "", qty: 1, rate: 0 }], taxPercent: 0, status: "draft", createdDate: todayStr() });
  const save = async (q) => { if (q.id) await quotesApi.update(q.id, q); else await quotesApi.add(q); setEditing(null); };
  const remove = async (id) => { await quotesApi.remove(id); setEditing(null); };
  const addLine = () => setEditing({ ...editing, lineItems: [...editing.lineItems, { desc: "", qty: 1, rate: 0 }] });
  const updateLine = (idx, patch) => setEditing({ ...editing, lineItems: editing.lineItems.map((l, i) => (i === idx ? { ...l, ...patch } : l)) });
  const removeLine = (idx) => setEditing({ ...editing, lineItems: editing.lineItems.filter((_, i) => i !== idx) });

  return (
    <div>
      <div className="hs-toolbar"><span className="hs-muted">{quotes.length} quote(s)/invoice(s)</span><button className="hs-btn primary" onClick={() => setEditing(blank())}><Plus size={16} /> New Quote</button></div>
      {quotes.length === 0 && <p className="hs-muted hs-empty">No quotes yet.</p>}
      <div className="hs-timeline">
        {quotes.map((q) => {
          const client = clients.find((c) => c.id === q.clientId);
          const event = events.find((e) => e.id === q.eventId);
          return (
            <div key={q.id} className="hs-timeline-row" onClick={() => setEditing(q)}>
              <div className="hs-timeline-date"><span className="hs-mono">{fmtDate(q.createdDate)}</span></div>
              <div className="hs-timeline-main"><strong>{client ? client.name : "No client"}</strong><span className="hs-muted">{event ? event.name : "No linked event"} &middot; {fmtMoney(quoteTotal(q))}</span></div>
              <StatusPill status={q.status} />
            </div>
          );
        })}
      </div>
      {editing && (
        <Modal title={editing.id ? "Edit Quote" : "New Quote"} onClose={() => setEditing(null)} wide>
          <div className="hs-field-row">
            <Field label="Client"><select value={editing.clientId || ""} onChange={(e) => setEditing({ ...editing, clientId: e.target.value })}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Linked Event"><select value={editing.eventId || ""} onChange={(e) => setEditing({ ...editing, eventId: e.target.value })}><option value="">None</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
            <Field label="Status"><select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>{QUOTE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
          </div>
          <div className="hs-panel-head" style={{ marginTop: 12 }}><span className="hs-eyebrow">Line Items</span><button className="hs-btn small" onClick={addLine}><Plus size={14} /> Add Line</button></div>
          {editing.lineItems.map((l, idx) => (
            <div key={idx} className="hs-quote-line">
              <input placeholder="Description" value={l.desc || ""} onChange={(e) => updateLine(idx, { desc: e.target.value })} />
              <input type="number" min="0" placeholder="Qty" style={{ width: 64 }} value={l.qty} onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })} />
              <input type="number" min="0" step="0.01" placeholder="Rate" style={{ width: 90 }} value={l.rate} onChange={(e) => updateLine(idx, { rate: Number(e.target.value) })} />
              <span className="hs-mono">{fmtMoney(l.qty * l.rate)}</span>
              <button className="hs-icon-btn danger" onClick={() => removeLine(idx)}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="hs-quote-totals"><Field label="Tax %"><input type="number" min="0" step="0.1" style={{ width: 80 }} value={editing.taxPercent} onChange={(e) => setEditing({ ...editing, taxPercent: Number(e.target.value) })} /></Field><span className="hs-quote-total-num">{fmtMoney(quoteTotal(editing))}</span></div>
          <div className="hs-modal-actions">{editing.id && <button className="hs-btn danger" onClick={() => remove(editing.id)}>Delete</button>}<button className="hs-btn primary" onClick={() => save(editing)}>Save Quote</button></div>
        </Modal>
      )}
    </div>
  );
}

/* ================= ADMIN: Team ================= */

function Team({ profiles, currentProfile }) {
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async (u) => {
    setSaving(true);
    if (u.id) {
      await profilesApi.update(u.id, { name: u.name, role: u.role });
    } else {
      // Pre-set a role for someone before they've registered — the trigger links it up by email when they sign up.
      await profilesApi.add(u);
    }
    setSaving(false);
    setEditing(null);
  };
  const remove = async (id) => { await profilesApi.remove(id); setEditing(null); };

  return (
    <div>
      <div className="hs-toolbar"><span className="hs-muted">{profiles.length} team member(s)</span><button className="hs-btn primary" onClick={() => setEditing({ name: "", email: "", role: "staff" })}><Plus size={16} /> Pre-set a Role</button></div>
      <p className="hs-muted" style={{ marginTop: -10, marginBottom: 16 }}>Everyone creates their own account on the sign-in page with their email and a password. New sign-ups land as Staff by default — change their role here once they're in. You can also pre-set someone's role before they sign up, using their email.</p>
      <div className="hs-tag-grid">
        {profiles.map((u) => {
          const Role = ROLES.find((r) => r.key === u.role) || ROLES[1];
          return (
            <div key={u.id} className="hs-client-card" onClick={() => setEditing(u)}>
              <strong>{u.name}{u.id === currentProfile.id ? " (you)" : ""}</strong>
              <div className="hs-muted" style={{ display: "flex", alignItems: "center", gap: 6 }}><Role.icon size={13} /> {Role.label}</div>
              <div className="hs-muted hs-mono">{u.email}</div>
              {u.status === "invited" && <span className="hs-badge warn" style={{ width: "fit-content", marginTop: 4 }}>Not registered yet</span>}
            </div>
          );
        })}
      </div>
      {editing && (
        <Modal title={editing.id ? "Edit Person" : "Pre-set a Role"} onClose={() => setEditing(null)}>
          <Field label="Name"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          {!editing.id && <Field label="Email"><input type="email" value={editing.email || ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} placeholder="name@example.com" /></Field>}
          <Field label="Role"><select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>{ROLES.filter((r) => r.key !== "admin" || editing.role === "admin").map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></Field>
          <div className="hs-modal-actions">
            {editing.id && editing.id !== currentProfile.id && <button className="hs-btn danger" onClick={() => remove(editing.id)}>Remove</button>}
            <button className="hs-btn primary" onClick={() => save(editing)} disabled={!editing.name || (!editing.id && !editing.email) || saving}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= ADMIN: Fleet ================= */

function Fleet({ fleet }) {
  const [editing, setEditing] = useState(null);
  const save = async (f) => { if (f.id) await fleetApi.update(f.id, f); else await fleetApi.add(f); setEditing(null); };
  const remove = async (id) => { await fleetApi.remove(id); setEditing(null); };
  return (
    <div>
      <div className="hs-toolbar"><span className="hs-muted">{fleet.length} vehicle(s) registered</span><button className="hs-btn primary" onClick={() => setEditing({ name: "", plate: "", type: "" })}><Plus size={16} /> Register Vehicle</button></div>
      <div className="hs-tag-grid">{fleet.map((f) => (<div key={f.id} className="hs-client-card" onClick={() => setEditing(f)}><strong>{f.name}</strong><span className="hs-muted hs-mono">{f.plate}</span><span className="hs-muted">{f.type}</span></div>))}</div>
      {editing && (
        <Modal title={editing.id ? "Edit Vehicle" : "Register Vehicle"} onClose={() => setEditing(null)}>
          <Field label="Vehicle Name"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <div className="hs-field-row"><Field label="Plate"><input value={editing.plate || ""} onChange={(e) => setEditing({ ...editing, plate: e.target.value })} /></Field><Field label="Type"><input value={editing.type || ""} placeholder="Van, Truck..." onChange={(e) => setEditing({ ...editing, type: e.target.value })} /></Field></div>
          <div className="hs-modal-actions">{editing.id && <button className="hs-btn danger" onClick={() => remove(editing.id)}>Remove</button>}<button className="hs-btn primary" onClick={() => save(editing)} disabled={!editing.name}>Save</button></div>
        </Modal>
      )}
    </div>
  );
}

/* ================= WAREHOUSE ================= */

function WarehouseView({ equipment, logs, currentProfile }) {
  const [action, setAction] = useState(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [scanned, setScanned] = useState(null);
  const [scanMiss, setScanMiss] = useState("");
  const scanRef = useRef(null);

  useEffect(() => { scanRef.current && scanRef.current.focus(); }, []);

  const ACTION_LABEL = { checkout: "Check Out", checkin: "Check In", repair: "Send to Repair", missing: "Mark Missing", repairReturn: "Return from Repair", missingFound: "Mark Found" };
  const openAction = (item, type) => { setAction({ item, type }); setQty(1); setNote(""); };

  const handleScanKeyDown = (e) => {
    if (e.key !== "Enter") return;
    const code = scanValue.trim();
    setScanValue("");
    if (!code) return;
    const match = equipment.find((i) => i.barcode === code || (i.code || "").toLowerCase() === code.toLowerCase());
    if (match) { setScanned(match); setScanMiss(""); } else { setScanned(null); setScanMiss(code); }
  };

  const apply = async () => {
    const { item, type } = action;
    const patch = {};
    if (type === "checkout") patch.qtyOut = item.qtyOut + qty;
    if (type === "checkin") patch.qtyOut = Math.max(0, item.qtyOut - qty);
    if (type === "repair") patch.qtyRepair = item.qtyRepair + qty;
    if (type === "missing") patch.qtyMissing = item.qtyMissing + qty;
    if (type === "repairReturn") patch.qtyRepair = Math.max(0, item.qtyRepair - qty);
    if (type === "missingFound") patch.qtyMissing = Math.max(0, item.qtyMissing - qty);
    await equipmentApi.update(item.id, patch);
    await equipmentApi.addLog({ equipmentId: item.id, type, qty, note, by: currentProfile.name });
    setAction(null);
  };

  const available = (item) => item.totalQty - item.qtyOut - item.qtyRepair - item.qtyMissing;
  const nameFor = (equipmentId) => equipment.find((i) => i.id === equipmentId)?.name || "Unknown item";

  return (
    <div>
      <div className="hs-panel" style={{ marginBottom: 18 }}>
        <span className="hs-eyebrow">Scan Equipment</span>
        <p className="hs-muted" style={{ marginTop: 4 }}>Click the box, then scan a tag with your external barcode/QR scanner.</p>
        <input ref={scanRef} className="hs-scan-input" value={scanValue} onChange={(e) => setScanValue(e.target.value)} onKeyDown={handleScanKeyDown} placeholder="Scan here..." autoFocus />
        {scanned && (
          <div className="hs-scan-result">
            <div><strong>{scanned.name}</strong><span className="hs-muted hs-mono"> &middot; {scanned.code}</span></div>
            <div className="hs-wh-actions">
              <button className="hs-btn small" onClick={() => { openAction(scanned, "checkout"); setScanned(null); }}>Check Out</button>
              <button className="hs-btn small" onClick={() => { openAction(scanned, "checkin"); setScanned(null); }}>Check In</button>
              <button className="hs-btn small" onClick={() => { openAction(scanned, "repair"); setScanned(null); }}><Wrench size={12} /> Repair</button>
              <button className="hs-btn small" onClick={() => { openAction(scanned, "missing"); setScanned(null); }}><AlertTriangle size={12} /> Missing</button>
              <button className="hs-icon-btn" onClick={() => setScanned(null)}><X size={14} /></button>
            </div>
          </div>
        )}
        {scanMiss && <p className="hs-danger-text" style={{ marginTop: 8 }}>No gear registered with code "{scanMiss}". Register it first in Inventory.</p>}
      </div>

      <div className="hs-tag-grid">
        {equipment.map((item) => (
          <div key={item.id} className="hs-case-tag wh">
            <div className="hs-case-stripe" />
            <div className="hs-case-body">
              <span className="hs-case-code hs-mono">{item.code}</span>
              <strong className="hs-case-name">{item.name}</strong>
              {item.barcode && <span className="hs-muted hs-mono">barcode: {item.barcode}</span>}
              <span className="hs-muted">{available(item)} / {item.totalQty} available</span>
              {(item.qtyOut > 0 || item.qtyRepair > 0 || item.qtyMissing > 0) && (
                <div className="hs-badge-row">
                  {item.qtyOut > 0 && <span className="hs-badge">{item.qtyOut} out</span>}
                  {item.qtyRepair > 0 && <span className="hs-badge warn">{item.qtyRepair} repair</span>}
                  {item.qtyMissing > 0 && <span className="hs-badge danger">{item.qtyMissing} missing</span>}
                </div>
              )}
              <div className="hs-wh-actions">
                <button className="hs-btn small" onClick={() => openAction(item, "checkout")} disabled={available(item) <= 0}>Check Out</button>
                <button className="hs-btn small" onClick={() => openAction(item, "checkin")} disabled={item.qtyOut <= 0}>Check In</button>
                <button className="hs-btn small" onClick={() => openAction(item, "repair")} disabled={available(item) <= 0}><Wrench size={12} /> Repair</button>
                <button className="hs-btn small" onClick={() => openAction(item, "missing")} disabled={available(item) <= 0}><AlertTriangle size={12} /> Missing</button>
                {item.qtyRepair > 0 && <button className="hs-btn small" onClick={() => openAction(item, "repairReturn")}>Returned</button>}
                {item.qtyMissing > 0 && <button className="hs-btn small" onClick={() => openAction(item, "missingFound")}>Found</button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hs-panel" style={{ marginTop: 20 }}>
        <div className="hs-panel-head"><span className="hs-eyebrow">Recent Warehouse Activity</span></div>
        {logs.length === 0 && <p className="hs-muted">No activity logged yet.</p>}
        {logs.slice(0, 12).map((l) => (
          <div key={l.id} className="hs-row">
            <div className="hs-row-main"><strong>{ACTION_LABEL[l.type]} &middot; {nameFor(l.equipmentId)}</strong><span className="hs-muted">{l.qty} unit(s) by {l.by}{l.note ? ` — ${l.note}` : ""}</span></div>
            <span className="hs-muted hs-mono">{fmtDateTime(l.timestamp)}</span>
          </div>
        ))}
      </div>

      {action && (
        <Modal title={`${ACTION_LABEL[action.type]} — ${action.item.name}`} onClose={() => setAction(null)}>
          <Field label="Quantity"><input type="number" min="1" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
          <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. cracked housing, going to Riverside gig" /></Field>
          <div className="hs-modal-actions"><button className="hs-btn primary" onClick={apply}>Confirm</button></div>
        </Modal>
      )}
    </div>
  );
}

/* ================= STAFF: My Events ================= */

function MyEvents({ currentProfile, events, equipment, clients }) {
  const mine = events.filter((e) => (e.assignedStaff || []).includes(currentProfile.id) && e.status !== "cancelled").sort((a, b) => a.startDate.localeCompare(b.startDate));
  return (
    <div>
      {mine.length === 0 && <p className="hs-muted hs-empty">You haven't been assigned to any events yet. Check back once admin schedules you in.</p>}
      <div className="hs-timeline">
        {mine.map((e) => {
          const client = clients.find((c) => c.id === e.clientId);
          return (
            <div key={e.id} className="hs-panel" style={{ marginBottom: 12 }}>
              <div className="hs-panel-head"><div><strong>{e.name}</strong><div className="hs-muted">{client ? client.name : "No client"} &middot; {e.venue || "No venue"}</div></div><StatusPill status={e.status} /></div>
              <p className="hs-muted hs-mono" style={{ margin: "4px 0 12px" }}>{fmtDate(e.startDate)}{e.endDate !== e.startDate ? ` \u2192 ${fmtDate(e.endDate)}` : ""}</p>
              <span className="hs-eyebrow">Gear You're Taking</span>
              {e.equipment.length === 0 && <p className="hs-muted">No gear assigned to this event.</p>}
              <div className="hs-chip-row" style={{ marginTop: 8 }}>{e.equipment.map((line, i) => { const item = equipment.find((it) => it.id === line.itemId); return item ? <span key={i} className="hs-chip on" style={{ cursor: "default" }}>{line.qty}&times; {item.name}</span> : null; })}</div>
              {e.notes && <p className="hs-muted" style={{ marginTop: 10 }}>{e.notes}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================= DRIVER: dashboard ================= */

function DriverDashboard({ currentProfile, journeys, fleet, events }) {
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [fuelOpen, setFuelOpen] = useState(false);
  const [fuelAmt, setFuelAmt] = useState("");
  const [purpose, setPurpose] = useState("event");
  const [fleetId, setFleetId] = useState(fleet[0]?.id || "");
  const [eventId, setEventId] = useState("");
  const [shipmentNote, setShipmentNote] = useState("");

  const activeJourney = journeys.find((j) => j.driverId === currentProfile.id && j.status === "active");
  const myHistory = journeys.filter((j) => j.driverId === currentProfile.id && j.status === "completed").sort((a, b) => b.startTime - a.startTime);
  const fleetInUse = new Set(journeys.filter((j) => j.status === "active").map((j) => j.fleetId));
  const availableFleet = fleet.filter((f) => !fleetInUse.has(f.id));

  const onStartCaptured = async (capture) => {
    await journeysApi.start({ driverId: currentProfile.id, fleetId, purpose, eventId: purpose === "event" ? eventId : "", shipmentNote: purpose === "shipment" ? shipmentNote : "", startOdometer: capture.reading, startPhoto: capture.photo, startLocation: capture.location });
    setStarting(false);
  };
  const onEndCaptured = async (capture) => {
    const miles = activeJourney.startOdometer != null && capture.reading != null ? Math.max(0, capture.reading - activeJourney.startOdometer) : null;
    await journeysApi.end(activeJourney.id, { endOdometer: capture.reading, endPhoto: capture.photo, endLocation: capture.location, milesTraveled: miles });
    setEnding(false);
  };
  const logFuel = async () => { await journeysApi.addFuel(activeJourney.id, Number(fuelAmt)); setFuelAmt(""); setFuelOpen(false); };

  const fleetName = (id) => fleet.find((f) => f.id === id)?.name || "Unknown vehicle";
  const destLabel = (j) => (j.purpose === "event" ? (events.find((e) => e.id === j.eventId)?.name || "Event") : (j.shipmentNote || "Shipment run"));

  return (
    <div>
      {!activeJourney && (
        <div className="hs-panel">
          <span className="hs-eyebrow">No Active Journey</span>
          <p className="hs-muted">Start a journey when you head out with a vehicle.</p>
          <button className="hs-btn primary" onClick={() => setStarting(true)} disabled={availableFleet.length === 0}><Truck size={16} /> Start Journey</button>
          {availableFleet.length === 0 && <p className="hs-muted" style={{ marginTop: 8 }}>No fleet vehicles free right now.</p>}
        </div>
      )}
      {activeJourney && (
        <div className="hs-panel">
          <span className="hs-eyebrow">Active Journey</span>
          <h3 style={{ margin: "6px 0" }}>{fleetName(activeJourney.fleetId)}</h3>
          <p className="hs-muted">Heading to: {destLabel(activeJourney)}</p>
          <p className="hs-muted hs-mono">Started {fmtDateTime(activeJourney.startTime)} at {activeJourney.startOdometer} mi</p>
          <div className="hs-fuel-list">{activeJourney.fuelLogs.map((f) => (<span key={f.id} className="hs-chip on" style={{ cursor: "default" }}><Fuel size={12} style={{ verticalAlign: "-2px" }} /> {fmtKsh(f.amount)}</span>))}</div>
          <div className="hs-modal-actions" style={{ justifyContent: "flex-start", marginTop: 12 }}><button className="hs-btn" onClick={() => setFuelOpen(true)}><Fuel size={14} /> Log Fuel</button><button className="hs-btn primary" onClick={() => setEnding(true)}>End Journey</button></div>
        </div>
      )}
      <div className="hs-panel" style={{ marginTop: 16 }}>
        <span className="hs-eyebrow">Trip History</span>
        {myHistory.length === 0 && <p className="hs-muted">No completed trips yet.</p>}
        {myHistory.map((j) => (<div key={j.id} className="hs-row"><div className="hs-row-main"><strong>{fleetName(j.fleetId)}</strong><span className="hs-muted">{destLabel(j)} &middot; {fmtDate(new Date(j.startTime).toISOString().slice(0, 10))}</span></div><span className="hs-mono">{j.milesTraveled != null ? `${j.milesTraveled} mi` : "—"}</span></div>))}
      </div>
      {starting && (
        <Modal title="Start Journey" onClose={() => setStarting(false)}>
          <Field label="Vehicle"><select value={fleetId} onChange={(e) => setFleetId(e.target.value)}>{availableFleet.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.plate})</option>)}</select></Field>
          <Field label="Purpose"><select value={purpose} onChange={(e) => setPurpose(e.target.value)}><option value="event">Driving to an event</option><option value="shipment">Shipment / supply run</option></select></Field>
          {purpose === "event" ? (
            <Field label="Event"><select value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">Select event</option>{events.filter((e) => e.status !== "cancelled").map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
          ) : (
            <Field label="What's the run for?"><input value={shipmentNote} onChange={(e) => setShipmentNote(e.target.value)} placeholder="e.g. picking up cabling from supplier" /></Field>
          )}
          <OdometerCapture label="Take a clear photo of the odometer before you head out." onDone={onStartCaptured} onCancel={() => setStarting(false)} />
        </Modal>
      )}
      {ending && (<Modal title="End Journey" onClose={() => setEnding(false)}><OdometerCapture label="Take a clear photo of the odometer now that you're back." onDone={onEndCaptured} onCancel={() => setEnding(false)} /></Modal>)}
      {fuelOpen && (
        <Modal title="Log Fuel" onClose={() => setFuelOpen(false)}>
          <Field label="Amount Fuelled (KSh)"><input type="number" min="0" step="1" value={fuelAmt} onChange={(e) => setFuelAmt(e.target.value)} placeholder="e.g. 3500" /></Field>
          <div className="hs-modal-actions"><button className="hs-btn primary" onClick={logFuel} disabled={!fuelAmt}>Save</button></div>
        </Modal>
      )}
    </div>
  );
}

/* ================= ADMIN: Drivers Log ================= */

function DriversLogAdmin({ journeys, profiles, fleet, events }) {
  const sorted = [...journeys].sort((a, b) => b.startTime - a.startTime);
  const driverName = (id) => profiles.find((u) => u.id === id)?.name || "Unknown";
  const fleetName = (id) => fleet.find((f) => f.id === id)?.name || "Unknown vehicle";
  const destLabel = (j) => (j.purpose === "event" ? (events.find((e) => e.id === j.eventId)?.name || "Event") : (j.shipmentNote || "Shipment run"));

  return (
    <div>
      {sorted.length === 0 && <p className="hs-muted hs-empty">No journeys logged yet.</p>}
      <div className="hs-timeline">
        {sorted.map((j) => {
          const totalFuel = j.fuelLogs.reduce((s, f) => s + f.amount, 0);
          return (
            <div key={j.id} className="hs-panel" style={{ marginBottom: 12 }}>
              <div className="hs-panel-head"><div><strong>{driverName(j.driverId)}</strong><div className="hs-muted">{fleetName(j.fleetId)} &middot; {destLabel(j)}</div></div><StatusPill status={j.status} /></div>
              <div className="hs-journey-grid">
                <div><span className="hs-eyebrow">Start</span><p className="hs-mono">{fmtDateTime(j.startTime)} &middot; {j.startOdometer ?? "—"} mi</p>{j.startPhoto && <img className="hs-odo-thumb" src={j.startPhoto} alt="start odometer" />}{j.startLocation && <a className="hs-loc-link" href={mapLink(j.startLocation)} target="_blank" rel="noreferrer"><MapPin size={12} /> View location</a>}</div>
                <div><span className="hs-eyebrow">End</span>{j.status === "completed" ? (<><p className="hs-mono">{fmtDateTime(j.endTime)} &middot; {j.endOdometer ?? "—"} mi</p>{j.endPhoto && <img className="hs-odo-thumb" src={j.endPhoto} alt="end odometer" />}{j.endLocation && <a className="hs-loc-link" href={mapLink(j.endLocation)} target="_blank" rel="noreferrer"><MapPin size={12} /> View location</a>}</>) : <p className="hs-muted">Still on the road</p>}</div>
                <div><span className="hs-eyebrow">Summary</span><p className="hs-mono">{j.milesTraveled != null ? `${j.milesTraveled} miles` : "—"}</p><p className="hs-mono">{totalFuel > 0 ? `${fmtKsh(totalFuel)} fuelled` : "No fuel logged"}</p></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- auth ---------- */

function SignIn() {
  const [mode, setMode] = useState("login"); // login | register
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    setSending(true); setError("");
    if (mode === "register") {
      const { error: err } = await supabase.auth.signUp({
        email, password,
        options: { data: { name } },
      });
      setSending(false);
      if (err) setError(err.message);
      // on success, onAuthStateChange in App picks up the new session automatically
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      setSending(false);
      if (err) setError(err.message);
    }
  };

  return (
    <div className="hs-login">
      <div className="hs-login-card">
        <div className="hs-logo"><Speaker size={22} />Harmony Sounds</div>
        <p className="hs-muted" style={{ marginTop: -6, marginBottom: 18 }}>
          {mode === "register"
            ? "Create your account — if you're the first person here, you'll be set up as admin. Otherwise your role is set by an admin afterward."
            : "Log in with your email and password."}
        </p>
        {mode === "register" && <Field label="Your Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>}
        <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></Field>
        <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "register" ? "At least 6 characters" : ""} /></Field>
        {error && <p className="hs-danger-text">{error}</p>}
        <button
          className="hs-btn primary"
          style={{ width: "100%", justifyContent: "center", marginTop: 6 }}
          disabled={!email || !password || (mode === "register" && !name) || sending}
          onClick={submit}
        >
          {sending ? "Please wait..." : mode === "register" ? "Create Account" : "Log In"}
        </button>
        <button
          className="hs-btn"
          style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
          onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); }}
        >
          {mode === "register" ? "Already have an account? Log in" : "New here? Create an account"}
        </button>
      </div>
    </div>
  );
}

/* ---------- App shell ---------- */

const NAV = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin"] },
  { key: "inventory", label: "Inventory", icon: Package, roles: ["admin"] },
  { key: "schedule", label: "Schedule", icon: Calendar, roles: ["admin"] },
  { key: "quotes", label: "Quotes", icon: FileText, roles: ["admin"] },
  { key: "clients", label: "Clients", icon: Users, roles: ["admin"] },
  { key: "warehouse", label: "Warehouse", icon: Package, roles: ["admin", "warehouse"] },
  { key: "fleet", label: "Fleet", icon: Truck, roles: ["admin"] },
  { key: "driverslog", label: "Drivers Log", icon: ClipboardList, roles: ["admin"] },
  { key: "team", label: "Team", icon: UserCog, roles: ["admin"] },
  { key: "myevents", label: "My Events", icon: Calendar, roles: ["staff"] },
  { key: "driver", label: "Driver Log", icon: Truck, roles: ["driver"] },
];

const PAGE_SUB = {
  dashboard: "Everything on the books, at a glance.", inventory: "What you own, and what's free right now.",
  schedule: "Every event, gear assigned, dates locked.", quotes: "Quotes out the door, invoices to chase.",
  clients: "Who you're working with.", warehouse: "Scan gear in and out, flag repairs and losses.",
  fleet: "Vehicles your drivers can check out.", driverslog: "Every trip: miles, fuel, and where the odometer photos were taken.",
  team: "Everyone with access, and their role.", myevents: "Events you're assigned to, and the gear going with you.",
  driver: "Start and end your journeys, log fuel as you go.",
};

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [myProfile, setMyProfile] = useState(undefined);
  const [tab, setTab] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMyProfile(session === null ? null : undefined); return; }
    let cancelled = false;
    let attempts = 0;
    const tryFetch = async () => {
      const { data } = await supabase.from("profiles").select("*").eq("auth_user_id", session.user.id).maybeSingle();
      if (cancelled) return;
      if (data) {
        setMyProfile({ id: data.id, name: data.name, email: data.email, role: data.role, status: data.status });
      } else if (attempts < 6) {
        attempts += 1;
        setTimeout(tryFetch, 800);
      } else {
        setMyProfile(null);
      }
    };
    tryFetch();
    return () => { cancelled = true; };
  }, [session]);

  const [equipment, logs, eqReady] = useEquipment();
  const [clients, clReady] = useClients();
  const [events, evReady] = useEvents();
  const [quotes, qReady] = useQuotes();
  const [fleet, flReady] = useFleet();
  const [journeys, jrReady] = useJourneys();
  const [profiles, prReady] = useProfiles();

  const dataReady = eqReady && clReady && evReady && qReady && flReady && jrReady && prReady;

  useEffect(() => {
    if (myProfile && !tab) {
      const first = NAV.find((n) => n.roles.includes(myProfile.role));
      setTab(first ? first.key : null);
    }
    if (!myProfile) setTab(null);
  }, [myProfile]);

  if (session === undefined || (session && myProfile === undefined)) {
    return <div className="hs-root"><div style={{ padding: 40 }}><p className="hs-muted">Loading...</p></div><style>{BASE_CSS}</style></div>;
  }

  if (!session) return (<div className="hs-root"><SignIn /><style>{BASE_CSS}</style></div>);

  if (myProfile === null) {
    return (
      <div className="hs-root">
        <div className="hs-login"><div className="hs-login-card">
          <div className="hs-logo"><Speaker size={22} />Harmony Sounds</div>
          <p className="hs-muted">We couldn't find your account yet. If you were just invited, wait a moment and refresh.</p>
          <button className="hs-btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 10 }} onClick={() => window.location.reload()}>Refresh</button>
          <button className="hs-btn" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} onClick={() => supabase.auth.signOut()}>Sign Out</button>
        </div></div>
        <style>{BASE_CSS}</style>
      </div>
    );
  }

  const navItems = NAV.filter((n) => n.roles.includes(myProfile.role));

  return (
    <div className="hs-root">
      <style>{BASE_CSS}</style>
      {!dataReady ? (
        <div style={{ padding: 40 }}><p className="hs-muted">Loading data...</p></div>
      ) : (
        <>
          <div className="hs-sidebar">
            <div className="hs-logo"><Speaker size={20} />Harmony Sounds</div>
            {navItems.map((n) => (<div key={n.key} className={`hs-nav-item ${tab === n.key ? "active" : ""}`} onClick={() => setTab(n.key)}><n.icon size={16} />{n.label}</div>))}
            <div className="hs-sidebar-foot">
              <div className="hs-whoami"><strong style={{ fontSize: 14 }}>{myProfile.name}</strong><span className="hs-muted">{ROLES.find((r) => r.key === myProfile.role)?.label}</span></div>
              <button className="hs-switch-btn" onClick={() => supabase.auth.signOut()}><LogOut size={14} /> Sign Out</button>
            </div>
          </div>
          <div className="hs-main">
            <h1 className="hs-page-title">{NAV.find((n) => n.key === tab)?.label}</h1>
            <p className="hs-page-sub">{PAGE_SUB[tab]}</p>
            {tab === "dashboard" && <Dashboard equipment={equipment} events={events} clients={clients} quotes={quotes} goTo={setTab} />}
            {tab === "inventory" && <Inventory equipment={equipment} />}
            {tab === "schedule" && <Schedule events={events} equipment={equipment} clients={clients} profiles={profiles} />}
            {tab === "quotes" && <Quotes quotes={quotes} clients={clients} events={events} />}
            {tab === "clients" && <Clients clients={clients} events={events} />}
            {tab === "warehouse" && <WarehouseView equipment={equipment} logs={logs} currentProfile={myProfile} />}
            {tab === "fleet" && <Fleet fleet={fleet} />}
            {tab === "driverslog" && <DriversLogAdmin journeys={journeys} profiles={profiles} fleet={fleet} events={events} />}
            {tab === "team" && <Team profiles={profiles} currentProfile={myProfile} />}
            {tab === "myevents" && <MyEvents currentProfile={myProfile} events={events} equipment={equipment} clients={clients} />}
            {tab === "driver" && <DriverDashboard currentProfile={myProfile} journeys={journeys} fleet={fleet} events={events} />}
          </div>
        </>
      )}
    </div>
  );
}

const BASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
.hs-root { --bg:#14171C; --panel:#1B1F27; --panel-2:#20242E; --border:#2B303B; --text:#EDEBE3; --muted:#8B92A0; --amber:#E8A33D; --teal:#3FA796; --red:#D9614F; font-family:'IBM Plex Sans',sans-serif; background:var(--bg); color:var(--text); min-height:100vh; display:flex; box-sizing:border-box; }
.hs-root * { box-sizing: border-box; }
.hs-mono { font-family:'JetBrains Mono',monospace; font-size:0.85em; }
.hs-accent-text { color: var(--teal); }
.hs-sidebar { width:220px; flex-shrink:0; background:var(--panel); border-right:1px solid var(--border); display:flex; flex-direction:column; padding:20px 14px; }
.hs-logo { font-family:'Oswald',sans-serif; font-weight:700; letter-spacing:0.06em; font-size:18px; text-transform:uppercase; padding:0 8px 20px 8px; border-bottom:1px solid var(--border); margin-bottom:16px; display:flex; align-items:center; gap:8px; color:var(--amber); }
.hs-nav-item { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:6px; cursor:pointer; color:var(--muted); font-size:14px; font-weight:500; margin-bottom:2px; border:1px solid transparent; }
.hs-nav-item:hover { color:var(--text); background:var(--panel-2); }
.hs-nav-item.active { color:var(--text); background:var(--panel-2); border-color:var(--border); box-shadow: inset 3px 0 0 var(--amber); }
.hs-sidebar-foot { margin-top:auto; padding-top:14px; border-top:1px solid var(--border); }
.hs-whoami { display:flex; flex-direction:column; gap:2px; padding:8px; margin-bottom:6px; }
.hs-switch-btn { display:flex; align-items:center; gap:8px; color:var(--muted); background:transparent; border:1px solid var(--border); padding:8px 10px; border-radius:6px; cursor:pointer; font-size:13px; width:100%; }
.hs-switch-btn:hover { color:var(--text); border-color:var(--amber); }
.hs-main { flex:1; padding:28px 36px; overflow-y:auto; }
.hs-page-title { font-family:'Oswald',sans-serif; font-size:26px; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; margin:0 0 4px 0; }
.hs-page-sub { color:var(--muted); margin:0 0 24px 0; font-size:14px; }
.hs-eyebrow { font-family:'Oswald',sans-serif; font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:var(--amber); }
.hs-muted { color:var(--muted); font-size:13px; }
.hs-empty { padding:24px 0; }
.hs-danger-text { color:var(--red); }
.hs-toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; gap:12px; flex-wrap:wrap; }
.hs-search { display:flex; align-items:center; gap:8px; background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:8px 12px; color:var(--muted); flex:1; max-width:320px; }
.hs-search input { background:transparent; border:none; outline:none; color:var(--text); font-size:14px; width:100%; }
.hs-btn { display:inline-flex; align-items:center; gap:6px; background:var(--panel-2); border:1px solid var(--border); color:var(--text); padding:9px 14px; border-radius:6px; font-size:13px; font-weight:500; cursor:pointer; text-decoration:none; }
.hs-btn:hover { border-color:var(--amber); }
.hs-btn.primary { background:var(--amber); color:#1A1400; border-color:var(--amber); }
.hs-btn.primary:hover { filter:brightness(1.08); }
.hs-btn.danger { background:transparent; color:var(--red); border-color:var(--red); }
.hs-btn.small { padding:5px 10px; font-size:12px; }
.hs-btn:disabled { opacity:0.5; cursor:not-allowed; }
.hs-icon-btn { background:transparent; border:1px solid var(--border); color:var(--muted); border-radius:5px; padding:6px; cursor:pointer; display:flex; }
.hs-icon-btn:hover { color:var(--text); border-color:var(--amber); }
.hs-icon-btn.danger:hover { color:var(--red); border-color:var(--red); }
.hs-pill { font-family:'JetBrains Mono',monospace; font-size:11px; text-transform:uppercase; padding:3px 9px; border-radius:20px; letter-spacing:0.04em; border:1px solid var(--border); }
.hs-pill-quote, .hs-pill-draft { color:var(--muted); }
.hs-pill-confirmed, .hs-pill-accepted, .hs-pill-sent, .hs-pill-active { color:var(--teal); border-color:var(--teal); }
.hs-pill-completed, .hs-pill-paid { color:var(--amber); border-color:var(--amber); }
.hs-pill-cancelled { color:var(--red); border-color:var(--red); }
.hs-stat-row { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:24px; }
.hs-stat-card { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:16px 18px; cursor:pointer; display:flex; flex-direction:column; gap:4px; }
.hs-stat-card:hover { border-color:var(--amber); }
.hs-stat-card.accent { border-color:var(--amber); }
.hs-stat-num { font-family:'Oswald',sans-serif; font-size:26px; font-weight:600; }
.hs-stat-label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:0.05em; }
.hs-dash-grid { display:grid; grid-template-columns:1.3fr 1fr; gap:16px; }
.hs-panel { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:16px 18px; }
.hs-panel-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.hs-row { display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-top:1px solid var(--border); cursor:pointer; }
.hs-row:first-of-type { border-top:none; }
.hs-row-main { display:flex; flex-direction:column; gap:2px; }
.hs-row-side { display:flex; align-items:center; gap:10px; }
.hs-warn-icon { color:var(--red); }
.hs-cat-block { margin-bottom:22px; }
.hs-tag-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; margin-top:10px; }
.hs-case-tag { position:relative; background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:12px 12px 12px 16px; overflow:hidden; }
.hs-case-tag.wh { padding-bottom:14px; }
.hs-case-stripe { position:absolute; left:0; top:0; bottom:0; width:6px; background:repeating-linear-gradient(45deg,var(--amber) 0 4px,#1A1400 4px 8px); }
.hs-case-body { display:flex; flex-direction:column; gap:4px; }
.hs-case-code { color:var(--amber); letter-spacing:0.03em; }
.hs-case-name { font-size:15px; }
.hs-case-meta { display:flex; justify-content:space-between; align-items:center; margin-top:4px; }
.hs-case-actions { position:absolute; top:8px; right:8px; display:flex; gap:4px; }
.hs-badge-row { display:flex; gap:6px; flex-wrap:wrap; margin-top:4px; }
.hs-badge { font-size:11px; padding:2px 7px; border-radius:10px; background:var(--panel-2); border:1px solid var(--border); color:var(--muted); }
.hs-badge.warn { color:var(--amber); border-color:var(--amber); }
.hs-badge.danger { color:var(--red); border-color:var(--red); }
.hs-wh-actions { display:flex; gap:5px; flex-wrap:wrap; margin-top:8px; }
.hs-scan-input { width:100%; background:var(--panel-2); border:2px solid var(--amber); color:var(--text); padding:12px 14px; border-radius:8px; font-size:15px; font-family:'JetBrains Mono',monospace; margin-top:10px; outline:none; }
.hs-scan-result { margin-top:12px; padding:12px; border-radius:8px; background:var(--panel-2); border:1px solid var(--teal); }
.hs-client-card { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:14px 16px; display:flex; flex-direction:column; gap:3px; cursor:pointer; }
.hs-client-card:hover { border-color:var(--amber); }
.hs-timeline { display:flex; flex-direction:column; gap:8px; }
.hs-timeline-row { display:flex; align-items:center; gap:20px; background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:12px 16px; cursor:pointer; }
.hs-timeline-row:hover { border-color:var(--amber); }
.hs-timeline-date { display:flex; flex-direction:column; width:130px; flex-shrink:0; }
.hs-timeline-main { display:flex; flex-direction:column; gap:2px; flex:1; }
.hs-chip-row { display:flex; gap:8px; flex-wrap:wrap; }
.hs-chip { background:var(--panel-2); border:1px solid var(--border); color:var(--muted); padding:6px 12px; border-radius:20px; font-size:12px; cursor:pointer; }
.hs-chip.on { color:var(--text); border-color:var(--amber); background:rgba(232,163,61,0.12); }
.hs-journey-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-top:12px; }
.hs-odo-thumb { width:100%; max-width:160px; border-radius:6px; border:1px solid var(--border); margin:6px 0; display:block; }
.hs-loc-link { display:inline-flex; align-items:center; gap:4px; color:var(--teal); font-size:12px; text-decoration:none; }
.hs-fuel-list { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
.hs-odo { margin-top:10px; }
.hs-odo-preview { display:flex; flex-direction:column; gap:8px; }
.hs-odo-preview img { max-width:100%; border-radius:8px; border:2px solid var(--border); }
.hs-odo-preview img.accepted { border-color:var(--teal); }
.hs-odo-preview img.rejected { border-color:var(--red); }
.hs-modal-backdrop { position:fixed; inset:0; background:rgba(10,12,15,0.7); display:flex; align-items:center; justify-content:center; z-index:50; padding:20px; }
.hs-modal { background:var(--panel); border:1px solid var(--border); border-radius:10px; width:420px; max-width:100%; max-height:85vh; overflow-y:auto; padding:18px 20px; }
.hs-modal.wide { width:640px; }
.hs-modal-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
.hs-field { display:flex; flex-direction:column; gap:5px; margin-bottom:12px; font-size:12px; color:var(--muted); flex:1; }
.hs-field-row { display:flex; gap:12px; }
.hs-field input, .hs-field select, .hs-field textarea { background:var(--panel-2); border:1px solid var(--border); color:var(--text); padding:8px 10px; border-radius:6px; font-size:14px; font-family:inherit; }
.hs-modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
.hs-gear-line, .hs-quote-line { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.hs-gear-line select, .hs-quote-line input:first-child { flex:1; }
.hs-gear-line select, .hs-gear-line input, .hs-quote-line input { background:var(--panel-2); border:1px solid var(--border); color:var(--text); padding:7px 9px; border-radius:6px; font-size:13px; }
.hs-quote-totals { display:flex; align-items:center; justify-content:flex-end; gap:16px; margin-top:10px; padding-top:10px; border-top:1px solid var(--border); }
.hs-quote-total-num { font-family:'Oswald',sans-serif; font-size:20px; color:var(--amber); }
.hs-login { flex:1; display:flex; align-items:center; justify-content:center; padding:20px; }
.hs-login-card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:24px; width:340px; max-width:100%; }
@media (max-width:720px) {
  .hs-root { flex-direction:column; }
  .hs-sidebar { width:100%; }
  .hs-stat-row, .hs-journey-grid { grid-template-columns:repeat(2,1fr); }
  .hs-dash-grid { grid-template-columns:1fr; }
  .hs-modal.wide, .hs-modal { width:100%; }
}
`;
