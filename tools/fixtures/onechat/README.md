# Real-screen regression fixtures

Captured read-only by the reviewer on 2026-10-18. `screens.json` keeps the trust
dialog (A) and only the input/footer structure from idle screens (B-D). Owner
conversation text is removed; paths and session names are replaced by fixtures.
`fresh-session.raw` preserves the supplied 120-column PTY escape stream, with
temporary paths replaced. It includes trust selection and the subsequent idle UI.
The `.gitattributes` rule preserves its CR/LF bytes across checkouts.

The raw stream uses ECH (`X`), CUP, CUF, EL/ED, alternate screen (`?1049`),
synchronized output (`?2026`), and private keyboard query (`?u`). The latter must
not restore the cursor. Tests replay every possible chunk boundary. Other VT
edit/scroll operations and a 48-column redraw are focused synthetic regressions;
the reviewer did not provide a raw recording of the narrow resumed screens.

These files never launch a CLI or refer to an owner's stored session.
