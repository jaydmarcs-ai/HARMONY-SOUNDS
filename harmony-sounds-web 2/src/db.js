import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";

/* ---------- generic live-table hook ---------- */
/* Refetches the given query whenever any row in `watchTables` changes.
   Simple and correct for team-scale data volumes. */

function useLiveQuery(queryFn, watchTables, deps = []) {
  const [data, setData] = useState([]);
  const [ready, setReady] = useState(false);

  const refetch = useCallback(async () => {
    const { data: rows, error } = await queryFn();
    if (!error) setData(rows || []);
    setReady(true);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refetch();
    const channel = supabase.channel(`live:${watchTables.join(",")}:${JSON.stringify(deps)}`);
    watchTables.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => refetch());
    });
    channel.subscribe();
    return () => supabase.removeChannel(channel);
  }, [refetch, watchTables.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return [data, ready, refetch];
}

/* ---------- mappers: db snake_case -> app camelCase ---------- */

const mapEquipment = (r) => ({
  id: r.id, code: r.code, barcode: r.barcode, name: r.name, category: r.category,
  totalQty: r.total_qty, dayRate: r.day_rate, qtyOut: r.qty_out, qtyRepair: r.qty_repair, qtyMissing: r.qty_missing,
});
const mapLog = (r) => ({ id: r.id, equipmentId: r.equipment_id, type: r.type, qty: r.qty, note: r.note, by: r.by_name, timestamp: new Date(r.created_at).getTime() });
const mapClient = (r) => ({ id: r.id, name: r.name, company: r.company, email: r.email, phone: r.phone });
const mapEvent = (r) => ({
  id: r.id, name: r.name, clientId: r.client_id, venue: r.venue, startDate: r.start_date, endDate: r.end_date,
  status: r.status, notes: r.notes,
  equipment: (r.event_equipment || []).map((e) => ({ rowId: e.id, itemId: e.equipment_id, qty: e.qty })),
  assignedStaff: (r.event_staff || []).map((s) => s.profile_id),
});
const mapQuote = (r) => ({
  id: r.id, clientId: r.client_id, eventId: r.event_id, taxPercent: r.tax_percent, status: r.status, createdDate: r.created_date,
  lineItems: (r.quote_line_items || []).map((l) => ({ id: l.id, desc: l.description, qty: l.qty, rate: l.rate })),
});
const mapFleet = (r) => ({ id: r.id, name: r.name, plate: r.plate, type: r.type });
const mapJourney = (r) => ({
  id: r.id, driverId: r.driver_id, fleetId: r.fleet_id, purpose: r.purpose, eventId: r.event_id, shipmentNote: r.shipment_note,
  status: r.status, startTime: r.start_time ? new Date(r.start_time).getTime() : null, startOdometer: r.start_odometer,
  startPhoto: r.start_photo, startLocation: r.start_lat != null ? { lat: r.start_lat, lng: r.start_lng } : null,
  endTime: r.end_time ? new Date(r.end_time).getTime() : null, endOdometer: r.end_odometer, endPhoto: r.end_photo,
  endLocation: r.end_lat != null ? { lat: r.end_lat, lng: r.end_lng } : null, milesTraveled: r.miles_traveled,
  fuelLogs: (r.fuel_logs || []).map((f) => ({ id: f.id, amount: f.amount, timestamp: new Date(f.created_at).getTime() })),
});
const mapProfile = (r) => ({ id: r.id, authUserId: r.auth_user_id, name: r.name, email: r.email, role: r.role, status: r.status });

/* ---------- hooks ---------- */

export function useEquipment() {
  const [rows, ready] = useLiveQuery(
    () => supabase.from("equipment").select("*").order("category").order("name"),
    ["equipment"]
  );
  const [logRows, logsReady] = useLiveQuery(
    () => supabase.from("equipment_logs").select("*").order("created_at", { ascending: false }).limit(50),
    ["equipment_logs"]
  );
  return [rows.map(mapEquipment), logRows.map(mapLog), ready && logsReady];
}

export function useClients() {
  const [rows, ready] = useLiveQuery(() => supabase.from("clients").select("*").order("name"), ["clients"]);
  return [rows.map(mapClient), ready];
}

export function useEvents() {
  const [rows, ready] = useLiveQuery(
    () => supabase.from("events").select("*, event_equipment(*), event_staff(profile_id)").order("start_date"),
    ["events", "event_equipment", "event_staff"]
  );
  return [rows.map(mapEvent), ready];
}

export function useQuotes() {
  const [rows, ready] = useLiveQuery(
    () => supabase.from("quotes").select("*, quote_line_items(*)").order("created_date", { ascending: false }),
    ["quotes", "quote_line_items"]
  );
  return [rows.map(mapQuote), ready];
}

export function useFleet() {
  const [rows, ready] = useLiveQuery(() => supabase.from("fleet").select("*").order("name"), ["fleet"]);
  return [rows.map(mapFleet), ready];
}

export function useJourneys() {
  const [rows, ready] = useLiveQuery(
    () => supabase.from("journeys").select("*, fuel_logs(*)").order("start_time", { ascending: false }),
    ["journeys", "fuel_logs"]
  );
  return [rows.map(mapJourney), ready];
}

export function useProfiles() {
  const [rows, ready] = useLiveQuery(() => supabase.from("profiles").select("*").order("name"), ["profiles"]);
  return [rows.map(mapProfile), ready];
}

/* ---------- mutations ---------- */

export const equipmentApi = {
  async add({ name, category, totalQty, dayRate, barcode, existingCount }) {
    const code = `HS-${category.slice(0, 3).toUpperCase()}-${String(existingCount + 1).padStart(3, "0")}`;
    return supabase.from("equipment").insert({ name, category, total_qty: totalQty, day_rate: dayRate, barcode: barcode || null, code }).select().single();
  },
  async update(id, patch) {
    const dbPatch = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.category !== undefined) dbPatch.category = patch.category;
    if (patch.totalQty !== undefined) dbPatch.total_qty = patch.totalQty;
    if (patch.dayRate !== undefined) dbPatch.day_rate = patch.dayRate;
    if (patch.barcode !== undefined) dbPatch.barcode = patch.barcode;
    if (patch.qtyOut !== undefined) dbPatch.qty_out = patch.qtyOut;
    if (patch.qtyRepair !== undefined) dbPatch.qty_repair = patch.qtyRepair;
    if (patch.qtyMissing !== undefined) dbPatch.qty_missing = patch.qtyMissing;
    return supabase.from("equipment").update(dbPatch).eq("id", id);
  },
  async remove(id) { return supabase.from("equipment").delete().eq("id", id); },
  async addLog({ equipmentId, type, qty, note, by }) {
    return supabase.from("equipment_logs").insert({ equipment_id: equipmentId, type, qty, note, by_name: by });
  },
};

export const clientsApi = {
  async add(c) { return supabase.from("clients").insert({ name: c.name, company: c.company, email: c.email, phone: c.phone }).select().single(); },
  async update(id, c) { return supabase.from("clients").update({ name: c.name, company: c.company, email: c.email, phone: c.phone }).eq("id", id); },
  async remove(id) { return supabase.from("clients").delete().eq("id", id); },
};

export const eventsApi = {
  async add(e) {
    const { data, error } = await supabase.from("events").insert({
      name: e.name, client_id: e.clientId || null, venue: e.venue, start_date: e.startDate, end_date: e.endDate, status: e.status, notes: e.notes,
    }).select().single();
    if (error) return { error };
    await syncEventLines(data.id, e.equipment, e.assignedStaff);
    return { data };
  },
  async update(id, e) {
    const { error } = await supabase.from("events").update({
      name: e.name, client_id: e.clientId || null, venue: e.venue, start_date: e.startDate, end_date: e.endDate, status: e.status, notes: e.notes,
    }).eq("id", id);
    if (error) return { error };
    await syncEventLines(id, e.equipment, e.assignedStaff);
    return {};
  },
  async remove(id) { return supabase.from("events").delete().eq("id", id); },
};

async function syncEventLines(eventId, equipmentLines, staffIds) {
  await supabase.from("event_equipment").delete().eq("event_id", eventId);
  if (equipmentLines && equipmentLines.length) {
    await supabase.from("event_equipment").insert(equipmentLines.map((l) => ({ event_id: eventId, equipment_id: l.itemId, qty: l.qty })));
  }
  await supabase.from("event_staff").delete().eq("event_id", eventId);
  if (staffIds && staffIds.length) {
    await supabase.from("event_staff").insert(staffIds.map((profileId) => ({ event_id: eventId, profile_id: profileId })));
  }
}

export const quotesApi = {
  async add(q) {
    const { data, error } = await supabase.from("quotes").insert({
      client_id: q.clientId || null, event_id: q.eventId || null, tax_percent: q.taxPercent, status: q.status, created_date: q.createdDate,
    }).select().single();
    if (error) return { error };
    await syncQuoteLines(data.id, q.lineItems);
    return { data };
  },
  async update(id, q) {
    const { error } = await supabase.from("quotes").update({
      client_id: q.clientId || null, event_id: q.eventId || null, tax_percent: q.taxPercent, status: q.status, created_date: q.createdDate,
    }).eq("id", id);
    if (error) return { error };
    await syncQuoteLines(id, q.lineItems);
    return {};
  },
  async remove(id) { return supabase.from("quotes").delete().eq("id", id); },
};

async function syncQuoteLines(quoteId, lineItems) {
  await supabase.from("quote_line_items").delete().eq("quote_id", quoteId);
  if (lineItems && lineItems.length) {
    await supabase.from("quote_line_items").insert(lineItems.map((l) => ({ quote_id: quoteId, description: l.desc, qty: l.qty, rate: l.rate })));
  }
}

export const fleetApi = {
  async add(f) { return supabase.from("fleet").insert({ name: f.name, plate: f.plate, type: f.type }).select().single(); },
  async update(id, f) { return supabase.from("fleet").update({ name: f.name, plate: f.plate, type: f.type }).eq("id", id); },
  async remove(id) { return supabase.from("fleet").delete().eq("id", id); },
};

export const journeysApi = {
  async start({ driverId, fleetId, purpose, eventId, shipmentNote, startOdometer, startPhoto, startLocation }) {
    return supabase.from("journeys").insert({
      driver_id: driverId, fleet_id: fleetId, purpose, event_id: eventId || null, shipment_note: shipmentNote || null,
      status: "active", start_time: new Date().toISOString(), start_odometer: startOdometer, start_photo: startPhoto,
      start_lat: startLocation ? startLocation.lat : null, start_lng: startLocation ? startLocation.lng : null,
    }).select().single();
  },
  async end(id, { endOdometer, endPhoto, endLocation, milesTraveled }) {
    return supabase.from("journeys").update({
      status: "completed", end_time: new Date().toISOString(), end_odometer: endOdometer, end_photo: endPhoto,
      end_lat: endLocation ? endLocation.lat : null, end_lng: endLocation ? endLocation.lng : null, miles_traveled: milesTraveled,
    }).eq("id", id);
  },
  async addFuel(journeyId, amount) { return supabase.from("fuel_logs").insert({ journey_id: journeyId, amount }); },
};

export const profilesApi = {
  async add({ name, email, role }) {
    return supabase.from("profiles").insert({ name, email, role, status: "invited" }).select().single();
  },
  async generateLink(email) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return { error: { message: "Not signed in" } };
    const res = await fetch("/.netlify/functions/generate-invite-link", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email }),
    });
    const json = await res.json();
    if (!res.ok) return { error: { message: json.error || "Couldn't generate the link" } };
    return { link: json.link };
  },
  async update(id, patch) { return supabase.from("profiles").update(patch).eq("id", id); },
  async remove(id) { return supabase.from("profiles").delete().eq("id", id); },
};
