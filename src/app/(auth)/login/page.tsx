"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const canvas = document.getElementById('sparks') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrameId: number;

    function resize() {
      const parent = canvas.parentElement;
      if (!parent) return;
      const r = parent.getBoundingClientRect();
      canvas.width = r.width;
      canvas.height = r.height;
    }
    resize();
    window.addEventListener('resize', resize);

    const COLORS = ['#f05a28', '#ff7a3d', '#ff9c6e', '#c43d10', '#ff5522', '#ffaa55', '#ff3300'];

    interface Particle {
      x: number; y: number; vx: number; vy: number;
      r: number; a: number; fade: number;
      color: string; w: number; ws: number;
    }

    const particles: Particle[] = [];

    function spawn(): Particle {
      return {
        x: Math.random() * canvas.width,
        y: canvas.height + 4,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -(Math.random() * 1.6 + 0.5),
        r: Math.random() * 2.4 + 0.4,
        a: Math.random() * 0.75 + 0.25,
        fade: Math.random() * 0.005 + 0.002,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        w: Math.random() * Math.PI * 2,
        ws: (Math.random() - 0.5) * 0.05,
      };
    }

    for (let i = 0; i < 180; i++) {
      const p = spawn();
      p.y = Math.random() * canvas.height;
      p.a *= Math.random() * 0.8;
      particles.push(p);
    }

    function frame() {
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      const newCount = Math.random() < 0.5 ? 2 : 3;
      for (let n = 0; n < newCount; n++) particles.push(spawn());

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.w += p.ws;
        p.x += p.vx + Math.sin(p.w) * 0.35;
        p.y += p.vy;
        p.a -= p.fade;
        if (p.a <= 0 || p.y < -8) { particles.splice(i, 1); continue; }
        ctx!.save();
        ctx!.globalAlpha = p.a;
        ctx!.fillStyle = p.color;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.restore();
      }
      animFrameId = requestAnimationFrame(frame);
    }

    frame();

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative overflow-hidden min-h-screen w-full flex flex-col items-center justify-center gap-6 px-4 sm:px-6">
      <canvas
        id="sparks"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
      />
      <div
        style={{
          position: 'absolute',
          top: '30%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '520px',
          height: '320px',
          background: 'radial-gradient(ellipse, rgba(240,90,40,0.09) 0%, transparent 70%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      <div className="relative z-10 flex flex-col items-center gap-6 w-full">
        <img src="/logo-light.png" alt="JedForge" className="w-full max-w-[90vw] sm:w-[512px] h-auto block dark:hidden" />
        <img src="/logo-dark.png" alt="JedForge" className="w-full max-w-[90vw] sm:w-[512px] h-auto hidden dark:block" />
        <div className="login-card relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 sm:p-8 shadow-2xl">
          <div
            className="absolute top-0 rounded-sm"
            style={{
              left: '10%',
              right: '10%',
              height: '1px',
              background: 'linear-gradient(90deg, transparent, rgba(240,90,40,0.55), transparent)',
            }}
          />
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-1">Welcome back</h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm">Sign in to your JedForge account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="email" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm min-h-[44px]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                placeholder="••••••••"
                className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm min-h-[44px]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-opacity text-sm mt-2 min-h-[44px]"
              style={{ background: '#f05a28' }}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="text-center text-zinc-500 text-sm mt-6">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-medium">
              Register
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
