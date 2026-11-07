# field-capability

Adopted requirements exit / story admission. Every identified new, changed or
high-risk field must be registered with granularity and storage plan. Explicitly
list required and verified storage, DTO/VO, conversion, query/index, import/export,
i18n name/value/enumeration and consumer capabilities. Existing capability uses
code evidence; planned capability uses a reproducible prototype/contract plus
consumer adaptation plan. Reuse unchanged-field baseline evidence only while its
inputs remain current. Performance measurements bind logs, command, unit, threshold
and observed result. Input-bound technical review confirms plan/evidence meaning.
Errors: FIELD_UNCOVERED, FIELD_CAPABILITY_UNVERIFIED, FIELD_PLAN_CONFLICT,
FIELD_PERFORMANCE_UNVERIFIED. Missing review never means success.
