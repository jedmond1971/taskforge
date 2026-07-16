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
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <code className="flex-1 break-all text-xs font-mono text-amber-300 select-all">
              {plaintext}
            </code>
            <button
              onClick={handleCopy}
              className="flex-shrink-0 p-1.5 rounded text-amber-400 hover:text-amber-200 hover:bg-amber-500/20 transition-colors"
              title="Copy to clipboard"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Store this key in a secure location such as a password manager or secrets manager.
            It cannot be recovered once dismissed.
          </p>
        </div>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white"
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
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Key name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.repeat && name.trim()) handleSubmit();
            }}
            placeholder="e.g. CI pipeline, Mobile app"
            className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 text-white"
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
          <div key={i} className="h-16 bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
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
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">API Keys</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Keys authenticate requests to the external REST API. Each key is scoped to this
            organization. The full key is shown only once at creation.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          size="sm"
          className="bg-indigo-600 hover:bg-indigo-500 text-white flex-shrink-0"
        >
          <Plus className="size-3.5 mr-1" />
          New key
        </Button>
      </div>

      {active.length === 0 && revoked.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No API keys yet</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-1">
            Create a key to start authenticating external API requests.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {active.length > 0 && (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
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
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
                Revoked
              </p>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden opacity-60">
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
    <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-900">
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {apiKey.name}
          </span>
          {apiKey.revokedAt && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
              Revoked
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="font-mono">{apiKey.keyPrefix}…</span>
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
          className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0"
        >
          <ShieldOff className="size-3.5 mr-1" />
          Revoke
        </Button>
      )}
    </div>
  );
}
