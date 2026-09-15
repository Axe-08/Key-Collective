<script lang="ts">
  let {
    pkceVerifier,
    pkceChallenge,
    pkceState,
  }: {
    pkceVerifier: string;
    pkceChallenge: string;
    pkceState: string;
  } = $props();
</script>

<div class="p-3 rounded-lg bg-black/40 border border-white/[0.08] text-[10px] font-mono space-y-1.5 text-white/70">
  <div class="text-indigo-300 font-semibold uppercase tracking-wider flex items-center gap-1">
    <span class="material-symbols-outlined text-xs">key</span> Web Crypto RFC 7636 Handshake Bundle
  </div>
  <div class="truncate">
    <span class="text-white/40">code_verifier:</span> {pkceVerifier || "0x4f82a1...64-char CSPRNG"}
  </div>
  <div class="truncate">
    <span class="text-white/40">code_challenge (S256):</span> {pkceChallenge || "BASE64URL(SHA256(verifier))"}
  </div>
  <div class="truncate">
    <span class="text-white/40">state_token:</span> {pkceState || "0x992b...anti-csrf"}
  </div>
  <div class="truncate">
    <span class="text-white/40">method:</span> S256 • client_id: Ov23lijtT90CwzFc8jcy
  </div>
</div>
