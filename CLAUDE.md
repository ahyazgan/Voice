# Çalışma Notları (Claude Code)

## GitHub otonomisi — onay sorma
Kullanıcı tam otomasyon istiyor. GitHub işlemlerini **sormadan** yürüt:
- Değişiklik bitince: commit → push → PR aç.
- CI yeşilse PR'ı **otomatik merge et** (squash), takipten çık.
- CI kırmızıysa teşhis et, düzelt, push et — sormadan.
- Review yorumlarına yanıt ver / düzelt.
- Onay isteme. Yalnızca gerçekten belirsiz/mimari-kritik bir karar veya
  yıkıcı (geri dönüşü zor) bir işlem varsa dur ve sor.

## Branch & commit
- Geliştirme branch'i: `claude/session-context-d7764q`.
- Merge sonrası local branch'i `origin/main`'e resetleyip devam et; gerekirse
  `--force-with-lease` ile push (kendi feature branch'i; merge edilmiş main'i
  asla yeniden yazma).
- Commit trailer'ları (her commit'te):
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0156y6p2pQpNt1bTVxkzDGbJ
  ```

## Doğrulama (PR'dan önce)
- `pnpm typecheck` ve `pnpm test` yeşil olmalı.
- Prisma client gerekiyorsa `pnpm db:generate` (kök `@prisma/client` dep'i sayesinde
  auto-install takılması yok).
