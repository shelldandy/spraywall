import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useCircuits, useRoutes } from "../lib/hooks/queries";
import { useCreateCircuit, useDeleteCircuit, useSetCircuitRoutes, useUpdateCircuit } from "../lib/hooks/mutations";
import type { Circuit } from "../lib/api/types";
import CircuitForm, { CircuitBadge, type CircuitFormValues } from "../components/CircuitForm";
import { circuitColor } from "../lib/circuitStyle";
import styles from "./Circuits.module.css";

export default function CircuitsPage() {
  const [params] = useSearchParams();
  const wallId = params.get("wallId") ?? "";
  const gymSlug = params.get("gymSlug") ?? "";
  const circuitsQuery = useCircuits(wallId, gymSlug);
  const routesQuery = useRoutes(wallId, gymSlug);
  const create = useCreateCircuit(gymSlug, wallId);
  const remove = useDeleteCircuit(gymSlug, wallId);
  const [createOpen, setCreateOpen] = useState(true);
  const backUrl = `/walls/${wallId}?${new URLSearchParams({ gymSlug })}`;
  const createCircuit = async (values: CircuitFormValues) => {
    try {
      await create.mutateAsync({ ...values, is_shared: false, route_ids: [] });
      setCreateOpen(false);
    } catch {
      // The mutation error is rendered beside the form.
    }
  };
  const routes = routesQuery.data ?? [];
  const circuits = circuitsQuery.data ?? [];

  return <div className={`screen ${styles.screen}`}>
    <header className="header"><Link className="btn btn-ghost" to={backUrl}>‹ Back</Link><h1>Circuits</h1><span /></header>
    <main className={`content ${styles.body}`}>
      <section className={styles.create} aria-label="Create a circuit">
        {createOpen ? <>
          <h2>New circuit</h2>
          <CircuitForm submitLabel="Create" pending={create.isPending} onSubmit={createCircuit} onCancel={() => setCreateOpen(false)} />
          {create.error && <p className="error-text" role="alert">{create.error.message}</p>}
        </> : <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>+ New circuit</button>}
      </section>
      {circuitsQuery.isLoading ? <div className="spinner" /> : circuitsQuery.isError ? <p className="error-text">{circuitsQuery.error.message}</p> : circuits.length === 0 ? <p className={styles.empty}>No circuits yet.</p> : circuits.map((circuit) => <CircuitCard key={circuit.id} circuit={circuit} gymSlug={gymSlug} wallId={wallId} routes={routes} circuitsFresh={!circuitsQuery.isFetching} onDelete={() => remove.mutate(circuit.id)} />)}
      {remove.error && <p className="error-text" role="alert">{remove.error.message}</p>}
    </main>
  </div>;
}

function CircuitCard({ circuit, gymSlug, wallId, routes, circuitsFresh, onDelete }: { circuit: Circuit; gymSlug: string; wallId: string; routes: { id: string; name: string }[]; circuitsFresh: boolean; onDelete: () => void }) {
  const update = useUpdateCircuit(gymSlug, wallId, circuit.id);
  const saveRoutes = useSetCircuitRoutes(gymSlug, wallId, circuit.id);
  const [pendingDraft, setPendingDraft] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  const draft = pendingDraft ?? circuit.route_ids;
  const isOwner = circuit.is_owner;
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const persistRoutes = async (next: string[]) => {
    setPendingDraft(next);
    try {
      await saveRoutes.mutateAsync(next);
    } catch {
      // Mutation errors are shown below; fall back to the latest server data.
    } finally {
      setPendingDraft(null);
    }
  };
  const move = (index: number, delta: number) => {
    const next = [...draft];
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    void persistRoutes(next);
  };
  const saveCircuit = async (values: CircuitFormValues) => {
    try {
      await update.mutateAsync(values);
      setEditing(false);
    } catch {
      // Mutation errors are shown below the editor.
    }
  };
  const startRoute = draft.map((id) => routeById.get(id)).find(Boolean);
  const climbParams = new URLSearchParams({ wallId, gymSlug, circuit: circuit.id });
  return <section className={styles.card} style={{ borderLeftColor: circuitColor(circuit.color) }}>
    <header className={styles.cardHeader}>
      <div><h2><CircuitBadge circuit={circuit} /></h2>{!isOwner && <p>Shared by {circuit.creator_name}</p>}</div>
      <div className={styles.headerActions}>
        {isOwner && <button type="button" className="btn btn-ghost" onClick={() => setEditing((value) => !value)}>{editing ? "Close editor" : "Edit"}</button>}
        {startRoute && <Link className="btn btn-primary" to={`/routes/${startRoute.id}?${climbParams}`}>Climb</Link>}
      </div>
    </header>
    {isOwner ? <>
      {editing && <div className={styles.editor}>
        <CircuitForm initial={{ name: circuit.name, color: circuit.color, emoji: circuit.emoji }} submitLabel="Save" pending={update.isPending} onSubmit={saveCircuit} onCancel={() => setEditing(false)} />
        {update.error && <p className="error-text" role="alert">{update.error.message}</p>}
      </div>}
      <label className={styles.share}><input type="checkbox" checked={circuit.is_shared} onChange={(event) => update.mutate({ is_shared: event.target.checked })} /> Share this circuit</label>
      <p className={styles.saveHint}>Order and route changes save immediately.</p>
      <ol className={styles.routes}>{draft.map((id, index) => <li key={id}><span>{routeById.get(id)?.name ?? "Unavailable route"}</span><button type="button" onClick={() => move(index, -1)} aria-label="Move up" disabled={!circuitsFresh || saveRoutes.isPending || index === 0}>↑</button><button type="button" onClick={() => move(index, 1)} aria-label="Move down" disabled={!circuitsFresh || saveRoutes.isPending || index === draft.length - 1}>↓</button><button type="button" onClick={() => void persistRoutes(draft.filter((routeId) => routeId !== id))} disabled={!circuitsFresh || saveRoutes.isPending}>Remove</button></li>)}</ol>
      <div className={styles.actions}><select aria-label="Add route" defaultValue="" disabled={!circuitsFresh || saveRoutes.isPending} onChange={(event) => { if (event.target.value && !draft.includes(event.target.value)) void persistRoutes([...draft, event.target.value]); event.target.value = ""; }}><option value="">Add route…</option>{routes.filter((route) => !draft.includes(route.id)).map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select><button type="button" className="btn btn-ghost" disabled={saveRoutes.isPending} onClick={() => { if (window.confirm(`Delete ${circuit.name}?`)) onDelete(); }}>Delete</button></div>
      {saveRoutes.error && <p className="error-text" role="alert">{saveRoutes.error.message}</p>}
      {update.error && !editing && <p className="error-text" role="alert">{update.error.message}</p>}
    </> : <ol className={styles.routes}>{circuit.route_ids.map((id) => <li key={id}>{routeById.get(id)?.name ?? "Unavailable route"}</li>)}</ol>}
  </section>;
}
