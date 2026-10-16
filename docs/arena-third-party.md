# Third-party notices

`src/lib/arena/camp/camp-crypto.mjs` adapts the XXTEA implementation, and
`src/lib/arena/camp/camp-transport.mjs` and `src/lib/arena/camp/camp-login.mjs` adapt private-protocol constants and request behavior,
from [lizupingsama/Honor-of-Kings-Match-Dashboard](https://github.com/lizupingsama/Honor-of-Kings-Match-Dashboard),
commit `c04acbabe21c85230c5911a07c6aba55577ea634`, specifically
`src/lib/camp/xxtea.ts`, `camp-api.ts`, and login form/signing behavior in
`wechat-login.ts`. QQ-specific login field mapping in the new exchange also
uses static observations of the supplied Camp APK. QQ and WeChat HTTP QR completion,
Camp exchange, data reads and saving were verified with the owner's scans on
2026-10-16. Daily-event single-battle detail request parameters and blue/red role
normalization also use the pinned `camp-api.ts` and `camp-client.ts`; the owner's
latest battle returned a complete ten-role panel. A real daily-event match with
ten registered participants has not yet been played through the new feature.

Author: lizupingsama and that project's contributors. The pinned source files
contain no additional copyright notice. The repository's actual LICENSE at
that commit is **Mulan Permissive Software License, Version 2**. Its README's
MIT claim conflicts with that file; we preserve the actual license in
[MulanPSL-2.0](licenses/MulanPSL-2.0.txt).

Changes include ES modules, strict URL and own-account request scope checks,
explicit network dependency injection, response validation, generic error
messages that do not reflect upstream content, and no storage or login code.

THE SOFTWARE AND CONTRIBUTION IN IT ARE PROVIDED WITHOUT WARRANTIES OF ANY
KIND, EITHER EXPRESS OR IMPLIED. IN NO EVENT SHALL ANY CONTRIBUTOR OR
COPYRIGHT HOLDER BE LIABLE TO YOU FOR ANY DAMAGES, INCLUDING, BUT NOT
LIMITED TO ANY DIRECT, OR INDIRECT, SPECIAL OR CONSEQUENTIAL DAMAGES ARISING
FROM YOUR USE OR INABILITY TO USE THE SOFTWARE OR THE CONTRIBUTION IN IT, NO
MATTER HOW IT'S CAUSED OR BASED ON WHICH LEGAL THEORY, EVEN IF ADVISED OF
THE POSSIBILITY OF SUCH DAMAGES.
