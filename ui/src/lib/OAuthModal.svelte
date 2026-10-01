<script lang="ts">
  // Sign-in (WP-3.4): Google only, then registration consent C1–C3 for new accounts.
  // GitHub is linked later from Settings; identity lives in the kc_session cookie.
  import ConsentScreen from './ConsentScreen.svelte';
  import { signInWithGoogleToken } from './auth/session';

  let {
    isOpen,
    onClose,
    onSignedIn,
    getGoogleIdToken = defaultGoogleIdToken,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSignedIn: () => void;
    getGoogleIdToken?: () => Promise<string>;
  } = $props();

  let step = $state<'sign-in' | 'consent'>('sign-in');
  let busy = $state(false);
  let error = $state('');

  async function defaultGoogleIdToken(): Promise<string> {
    const { signInWithPopup, auth, googleProvider } = await import('./firebase');
    const result = await signInWithPopup(auth, googleProvider);
    return result.user.getIdToken();
  }

  async function continueWithGoogle() {
    busy = true;
    error = '';
    try {
      const next = await signInWithGoogleToken(await getGoogleIdToken());
      if (next === 'consent') {
        step = 'consent';
      } else {
        finish();
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Google sign-in failed';
    } finally {
      busy = false;
    }
  }

  function finish() {
    step = 'sign-in';
    onSignedIn();
    onClose();
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <button type="button" class="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close" onclick={onClose}></button>
    <div class="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d0f14] p-6 shadow-2xl">
      {#if step === 'sign-in'}
        <h2 class="text-lg font-semibold text-white mb-1">Sign in to Key Collective</h2>
        <p class="text-sm text-white/60 mb-5">Use your Google account. You can link GitHub later to join the community pool.</p>
        <button
          type="button"
          data-testid="google-sign-in"
          onclick={continueWithGoogle}
          disabled={busy}
          class="w-full bg-white hover:bg-[#f8f9fa] text-gray-800 font-semibold py-3.5 px-5 rounded-xl flex items-center justify-center gap-3 disabled:opacity-50"
        >
          <svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {busy ? 'Signing in…' : 'Continue with Google'}
        </button>
        {#if error}<p class="mt-3 text-sm text-red-400" role="alert">{error}</p>{/if}
      {:else}
        <ConsentScreen onConsented={finish} />
      {/if}
    </div>
  </div>
{/if}
