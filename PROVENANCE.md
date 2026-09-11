# Provenance

SHPBL discovers the invention; this package implements it from a written specification.

- The design originates in SHPBL's capability library. The invention was published first as
  a public behaviour specification (`SPEC-retrieval-context-provenance-auditor`, v1.0).
- This implementation was written fresh from that specification. No harvested capability
  body was quoted, translated, or structurally reproduced.
- The source-trust and source-retirement layer is **clean-room**: implemented from the
  specification's properties T1–T10 with this package's own published constants. No private
  weighting constant, curve, threshold, or tier vocabulary was consulted or reproduced, and
  verification never compares output to a private reference implementation.
- Digest computation is SHA-256 only. No short or non-cryptographic hash is used anywhere.
- No third-party code is vendored. Runtime dependencies: none.

## Release gate

All release gates are cleared, in order:

1. conformance tests passing,
2. an exact-file IP surface review of every file that ships — 21/21 reviewed, none removed,
3. an explicit MIT implementation grant naming that exact reviewed file set,
4. licence file and publication.

The grant covers this enumerated set of files only. Anything outside it — including any SHPBL
capability body, private constant, or internal document — is not licensed by this repository.
Tenable submission and Contribution Agreement acceptance are separate decisions and have not
been made.
