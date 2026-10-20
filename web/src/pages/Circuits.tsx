import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useCircuits, useRoutes } from "../lib/hooks/queries";
import { useCreateCircuit, useDeleteCircuit, useSetCircuitRoutes, useUpdateCircuit } from "../lib/hooks/mutations";
import { useGoBack } from "../lib/nav";
import type { Circuit } from "../lib/api/types";
import styles from "./Circuits.module.css";

export default function CircuitsPage() {
  const [params] = useSearchParams();
  const wallId = params.get("wallId") ?? "";
  const gymSlug = params.get("gymSlug") ?? "";
  const circuitsQuery = useCircuits(wallId, gymSlug);
  const routesQuery = useRoutes(wallId, gymSlug);
  const create = useCreateCircuit(gymSlug, wallId);
  const remove = useDeleteCircuit(gymSlug, wallId);
  const [name, setName] = useState("");
  const goBack = useGoBack(`/walls/${wallId}`);
  const createCircuit = async (event: React.FormEvent) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    await create.mutateAsync({ name: clean, is_shared: false, route_ids: [] });
    setName("");
  };
  const routes = routesQuery.data ?? [];
  const circuits = circuitsQuery.data ?? [];

  return <div className={`screen ${styles.screen}`}>
    <header className="header"><button type="button" className="btn btn-ghost" onClick={goBack}>‹ Back</button><h1>Circuits</h1><span /></header>
    <main className={`content ${styles.body}`}>
      <form className={styles.create} onSubmit={(event) => void createCircuit(event)}>
        <label htmlFor="circuit-name">New circuit</label><div><input id="circuit-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Circuit name" maxLength={80} /><button className="btn btn-primary" disabled={!name.trim() || create.isPending}>Create</button></div>
        {create.error && <p className="error-text" role="alert">{create.error.message}</p>}
      </form>
      {circuitsQuery.isLoading ? <div className="spinner" /> : circuitsQuery.isError ? <p className="error-text">{circuitsQuery.error.message}</p> : circuits.length === 0 ? <p className={styles.empty}>No circuits yet.</p> : circuits.map((circuit) => <CircuitCard key={circuit.id} circuit={circuit} gymSlug={gymSlug} wallId={wallId} routes={routes} onDelete={() => remove.mutate(circuit.id)} />)}
      {remove.error && <p className="error-text" role="alert">{remove.error.message}</p>}
    </main>
  </div>;
}

function CircuitCard({ circuit, gymSlug, wallId, routes, onDelete }: { circuit: Circuit; gymSlug: string; wallId: string; routes: { id: string; name: string }[]; onDelete: () => void }) {
  const update = useUpdateCircuit(gymSlug, wallId, circuit.id);
  const saveRoutes = useSetCircuitRoutes(gymSlug, wallId, circuit.id);
  const [draft, setDraft] = useState(circuit.route_ids);
  const [rename, setRename] = useState(circuit.name);
  const isOwner = circuit.is_owner;
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const move = (index: number, delta: number) => {
    const next = [...draft];
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    setDraft(next);
  };
  const startRoute = draft.map((id) => routeById.get(id)).find(Boolean);
  return <section className={styles.card}>
    <header className={styles.cardHeader}><div><h2>{circuit.name}</h2>{!isOwner && <p>Shared by {circuit.creator_name}</p>}</div>{startRoute && <Link className="btn btn-primary" to={`/routes/${startRoute.id}?${new URLSearchParams({ wallId, gymSlug })}`}>Climb</Link>}</header>
    {isOwner ? <>
      <form className={styles.rename} onSubmit={(event) => { event.preventDefault(); if (rename.trim() && rename.trim() !== circuit.name) update.mutate({ name: rename.trim() }); }}><input aria-label={`Rename ${circuit.name}`} value={rename} onChange={(event) => setRename(event.target.value)} /><button className="btn btn-ghost">Rename</button></form>
      <label className={styles.share}><input type="checkbox" checked={circuit.is_shared} onChange={(event) => update.mutate({ is_shared: event.target.checked })} /> Share this circuit</label>
      <ol className={styles.routes}>{draft.map((id, index) => <li key={id}><span>{routeById.get(id)?.name ?? "Unavailable route"}</span><button type="button" onClick={() => move(index, -1)} aria-label="Move up" disabled={index === 0}>↑</button><button type="button" onClick={() => move(index, 1)} aria-label="Move down" disabled={index === draft.length - 1}>↓</button><button type="button" onClick={() => setDraft(draft.filter((routeId) => routeId !== id))}>Remove</button></li>)}</ol>
      <div className={styles.actions}><select aria-label="Add route" defaultValue="" onChange={(event) => { if (event.target.value && !draft.includes(event.target.value)) setDraft([...draft, event.target.value]); event.target.value = ""; }}><option value="">Add route…</option>{routes.filter((route) => !draft.includes(route.id)).map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select><button className="btn btn-primary" disabled={saveRoutes.isPending} onClick={() => saveRoutes.mutate(draft)}>Save order</button><button className="btn btn-ghost" onClick={() => { if (window.confirm(`Delete ${circuit.name}?`)) onDelete(); }}>Delete</button></div>
      {(update.error || saveRoutes.error) && <p className="error-text" role="alert">{update.error?.message ?? saveRoutes.error?.message}</p>}
    </> : <ol className={styles.routes}>{circuit.route_ids.map((id) => <li key={id}>{routeById.get(id)?.name ?? "Unavailable route"}</li>)}</ol>}
  </section>;
}
