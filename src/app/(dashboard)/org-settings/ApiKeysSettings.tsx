"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Copy, Check, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { MonoMeta } from "@/components/ui/mono-meta";
import { listApiKeys, createApiKey, revokeApiKey, type ApiKeyRow } from "./actions";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function KeyCreatedDialog({
  open,
  onOpenChange,
  plaintext,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plaintext: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(plaintext).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>API key created</DialogTitle>
          <DialogDescription>
            Copy this key now. You won&apos;t be able to see it again after closing this dialog.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3">
            <code className="flex-1 break-all text-xs font-mono text-warning select-all">
              {plaintext}
            </code>
            <button
              onClick={handleCopy}
              className="flex-shrink-0 p-1.5 rounded text-warning hover:bg-warning/20 transition-colors"
              title="Copy to clipboard"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Store this key in a secure location such as a password manager or secrets manager.
            It cannot be recovered once dismissed.
          </p>
        </div>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
          >
            I&apos;ve saved the key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
  orgId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onCreated: (key: ApiKeyRow, plaintext: string) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const result = await createApiKey(orgId, name);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      onOpenChange(false);
      onCreated(result.key, result.plaintext);
    } catch {
      toast.error("Failed to create API key");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>
            Give this key a descriptive name so you can identify it later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">
            Key name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.repeat && name.trim()) handleSubmit();
            }}
            placeholder="e.g. CI pipeline, Mobile app"
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
          >
            {saving ? "Creating..." : "Create key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ApiKeysSettings({ orgId }: { orgId: string }) {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newPlaintext, setNewPlaintext] = useState<string | null>(null);
  const [revokingKey, setRevokingKey] = useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = useState(false);
  const hasFetched = useRef(false);

  async function loadKeys() {
    try {
      const data = await listApiKeys(orgId);
      setKeys(data);
    } catch {
      toast.error("Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!hasFetched.current) {
      hasFetched.current = true;
      loadKeys();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCreated(key: ApiKeyRow, plaintext: string) {
    setKeys((prev) => [key, ...prev]);
    setNewPlaintext(plaintext);
  }

  async function handleRevoke() {
    if (!revokingKey) return;
    setRevoking(true);
    try {
      const result = await revokeApiKey(orgId, revokingKey.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("API key revoked");
      setKeys((prev) =>
        prev.map((k) =>
          k.id === revokingKey.id ? { ...k, revokedAt: new Date().toISOString() } : k
        )
      );
      setRevokingKey(null);
    } catch {
      toast.error("Failed to revoke API key");
    } finally {
      setRevoking(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 bg-surface-active rounded-lg" />
        ))}
      </div>
    );
  }

  const active = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-foreground mb-1">API Keys</h3>
          <p className="text-xs text-muted-foreground">
            Keys authenticate requests to the external REST API. Each key is scoped to this
            organization. The full key is shown only once at creation.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          size="sm"
          className="flex-shrink-0"
        >
          <Plus className="size-3.5 mr-1" />
          New key
        </Button>
      </div>

      {active.length === 0 && revoked.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border">
          <EmptyState
            icon={Plus}
            title="No API keys yet"
            message="Create a key to start authenticating external API requests."
            className="py-12"
          />
        </div>
      ) : (
        <div className="space-y-4">
          {active.length > 0 && (
            <div className="divide-y divide-border-soft rounded-xl border border-border-soft overflow-hidden">
              {active.map((key) => (
                <KeyRow
                  key={key.id}
                  apiKey={key}
                  onRevoke={() => setRevokingKey(key)}
                />
              ))}
            </div>
          )}

          {revoked.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Revoked
              </p>
              <div className="divide-y divide-border-soft rounded-xl border border-border-soft overflow-hidden opacity-60">
                {revoked.map((key) => (
                  <KeyRow key={key.id} apiKey={key} onRevoke={null} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        orgId={orgId}
        onCreated={handleCreated}
      />

      {newPlaintext && (
        <KeyCreatedDialog
          open={true}
          onOpenChange={(open) => { if (!open) setNewPlaintext(null); }}
          plaintext={newPlaintext}
        />
      )}

      <ConfirmDialog
        open={!!revokingKey}
        onOpenChange={(open) => { if (!open && !revoking) setRevokingKey(null); }}
        title={`Revoke "${revokingKey?.name}"?`}
        description="This key will stop authenticating requests immediately. This action cannot be undone."
        confirmLabel={revoking ? "Revoking..." : "Revoke key"}
        onConfirm={handleRevoke}
      />
    </div>
  );
}

function KeyRow({
  apiKey,
  onRevoke,
}: {
  apiKey: ApiKeyRow;
  onRevoke: (() => void) | null;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-surface">
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {apiKey.name}
          </span>
          {apiKey.revokedAt && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-danger-soft text-danger border border-danger/20">
              Revoked
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <MonoMeta>{apiKey.keyPrefix}…</MonoMeta>
          <span>Created {formatDate(apiKey.createdAt)} by {apiKey.createdBy.name}</span>
          {apiKey.lastUsedAt && <span>Last used {formatDate(apiKey.lastUsedAt)}</span>}
          {apiKey.revokedAt && <span>Revoked {formatDate(apiKey.revokedAt)}</span>}
        </div>
      </div>

      {onRevoke && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRevoke}
          className="text-muted-foreground hover:text-danger hover:bg-danger-soft flex-shrink-0"
        >
          <ShieldOff className="size-3.5 mr-1" />
          Revoke
        </Button>
      )}
    </div>
  );
}
