import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import type { AuthConfig, Me } from "../lib/api/types";
import { useAuthConfig, useMe } from "../lib/hooks/queries";
import {
  useChangePassword,
  useRemoveAvatar,
  useStartOidcLink,
  useUnlinkIdentity,
  useUpdateDisplayName,
  useUploadAvatar,
} from "../lib/hooks/mutations";
import { prepareImageForUpload } from "../lib/image";
import { useGoBack } from "../lib/nav";
import { oidcErrorMessage } from "../lib/oidc";
import { toast } from "../lib/toast";
import styles from "./Profile.module.css";

const AVATAR_DIMENSION = 512;
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 8;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export default function ProfilePage() {
  const goBack = useGoBack("/settings");
  const meQuery = useMe();
  const configQuery = useAuthConfig();
  useLinkResultToast();

  const me = meQuery.data;

  return (
    <div className={`screen ${styles.page}`}>
      <main className={styles.container}>
        <h1 className={styles.title}>Profile</h1>

        {meQuery.isPending ? (
          <div className={styles.loader}>
            <div className="spinner" />
          </div>
        ) : !me ? (
          <p className="error-text">{meQuery.error?.message ?? "Failed to load profile"}</p>
        ) : (
          <>
            <AvatarSection me={me} />
            <DisplayNameSection me={me} />
            {/* Unknown config (offline, error) is treated like the defaults: passwords on, no SSO. */}
            {(configQuery.data?.password_enabled ?? true) && <PasswordSection me={me} />}
            {configQuery.data?.oidc.enabled && (
              <LinkedAccountsSection me={me} config={configQuery.data} />
            )}
          </>
        )}

        <button type="button" className={`btn btn-primary ${styles.back}`} onClick={goBack}>
          Back
        </button>
      </main>
    </div>
  );
}

/** The link flow lands back here with `?linked=1` or `?error=<code>`; report it once, then tidy the URL. */
function useLinkResultToast() {
  const [searchParams, setSearchParams] = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const linked = searchParams.get("linked");
    const error = searchParams.get("error");
    if (!linked && !error) return;
    handled.current = true;

    if (error) toast(oidcErrorMessage(error), "error");
    else toast("Account linked.");
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);
}

function AvatarSection({ me }: { me: Me }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const busy = preparing || upload.isPending || remove.isPending;

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires a change.
    e.target.value = "";
    if (!file) return;

    setPreparing(true);
    const image = await prepareImageForUpload(file, AVATAR_DIMENSION).catch(() => file);
    setPreparing(false);
    if (image.size > AVATAR_MAX_BYTES) {
      toast("That photo is too large (max 5 MB).", "error");
      return;
    }
    upload.mutate(image, { onSuccess: () => toast("Photo updated.") });
  };

  return (
    <section className={`${styles.section} ${styles.avatarSection}`}>
      {me.avatar_url ? (
        <img className={styles.avatar} src={me.avatar_url} alt="" />
      ) : (
        <div className={`${styles.avatar} ${styles.initials}`} aria-hidden="true">
          {initials(me.display_name) || "?"}
        </div>
      )}
      <div className={styles.avatarActions}>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={handleFile}
        />
        <button
          type="button"
          className="btn"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          {preparing || upload.isPending ? "Uploading..." : "Change photo"}
        </button>
        {me.avatar_url && (
          <button
            type="button"
            className={`btn btn-ghost ${styles.danger}`}
            onClick={() => remove.mutate(undefined, { onSuccess: () => toast("Photo removed.") })}
            disabled={busy}
          >
            Remove
          </button>
        )}
      </div>
    </section>
  );
}

function DisplayNameSection({ me }: { me: Me }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me.display_name);
  const update = useUpdateDisplayName();

  const startEditing = () => {
    setName(me.display_name);
    setEditing(true);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || update.isPending) return;
    if (trimmed === me.display_name) {
      setEditing(false);
      return;
    }
    update.mutate(trimmed, {
      onSuccess: () => {
        setEditing(false);
        toast("Name updated.");
      },
    });
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.label}>Display Name</h2>
      {editing ? (
        <form className={styles.inlineForm} onSubmit={handleSubmit}>
          <input
            className="input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            autoCorrect="off"
            enterKeyHint="done"
            autoFocus
          />
          <div className={styles.row}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name.trim() || update.isPending}
            >
              {update.isPending ? "Saving..." : "Save"}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.row}>
          <p className={styles.value}>{me.display_name}</p>
          <button type="button" className="btn btn-ghost" onClick={startEditing}>
            Edit
          </button>
        </div>
      )}
      <h2 className={`${styles.label} ${styles.subLabel}`}>Email</h2>
      <p className={styles.value}>{me.email}</p>
    </section>
  );
}

function PasswordSection({ me }: { me: Me }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const change = useChangePassword();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (me.has_password && !current) {
      setError("Please enter your current password.");
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    change.mutate(
      { ...(me.has_password ? { current_password: current } : {}), new_password: next },
      {
        onSuccess: () => {
          setCurrent("");
          setNext("");
          setConfirm("");
          toast(me.has_password ? "Password changed." : "Password set.");
        },
      },
    );
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.label}>{me.has_password ? "Change password" : "Set password"}</h2>
      {!me.has_password && (
        <p className={styles.hint}>Add a password to also log in with your email.</p>
      )}
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {/* Lets password managers associate the new password with this account. */}
        <input type="email" value={me.email} autoComplete="username" readOnly hidden />
        {me.has_password && (
          <input
            className="input"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            enterKeyHint="next"
          />
        )}
        <input
          className="input"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="New password"
          autoComplete="new-password"
          enterKeyHint="next"
        />
        <input
          className="input"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
          enterKeyHint="go"
        />
        {error && <p className={`error-text ${styles.formError}`}>{error}</p>}
        <button
          type="submit"
          className={`btn btn-primary ${styles.formSubmit}`}
          disabled={change.isPending}
        >
          {change.isPending
            ? "Saving..."
            : me.has_password
              ? "Change password"
              : "Set password"}
        </button>
      </form>
    </section>
  );
}

function LinkedAccountsSection({ me, config }: { me: Me; config: AuthConfig }) {
  const unlink = useUnlinkIdentity();
  const link = useStartOidcLink();
  // The server refuses to remove the last way in; mirror that so the button explains itself.
  const isOnlyLogin =
    me.identities.length === 1 && (!me.has_password || !config.password_enabled);
  const alreadyLinked = me.identities.some((i) => i.provider_name === config.oidc.name);

  return (
    <section className={styles.section}>
      <h2 className={styles.label}>Linked Accounts</h2>
      {me.identities.length === 0 && <p className={styles.hint}>No linked accounts.</p>}
      <ul className={styles.identities}>
        {me.identities.map((identity) => (
          <li key={identity.id} className={styles.identity}>
            <div className={styles.identityInfo}>
              <span className={styles.identityProvider}>{identity.provider_name}</span>
              {identity.email && <span className={styles.identityEmail}>{identity.email}</span>}
              {isOnlyLogin && (
                <span className={styles.hint}>Your only way to log in, so it can&apos;t be unlinked.</span>
              )}
            </div>
            <button
              type="button"
              className={`btn btn-ghost ${styles.danger}`}
              disabled={isOnlyLogin || unlink.isPending}
              onClick={() =>
                unlink.mutate(identity.id, {
                  onSuccess: () => toast(`${identity.provider_name} unlinked.`),
                })
              }
            >
              Unlink
            </button>
          </li>
        ))}
      </ul>
      {!alreadyLinked && (
        <button
          type="button"
          className={`btn ${styles.linkButton}`}
          onClick={() => link.mutate()}
          disabled={link.isPending}
        >
          {link.isPending ? "Redirecting..." : `Link ${config.oidc.name}`}
        </button>
      )}
    </section>
  );
}
