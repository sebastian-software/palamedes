# Palamedes

Palamedes connects message authoring, extraction, translation, and application
localization through a shared message model.

## Language

**Source message**:
The authored text and optional disambiguating context that identify a message
through extraction and translation.
_Avoid_: Author-facing message ID

**Source catalog**:
A collection of source messages and their translations maintained for the
translation workflow.
_Avoid_: Runtime catalog when referring to translation inputs

**Compiled catalog**:
A collection of translated messages prepared for application execution without
interpreting their source patterns.
_Avoid_: String catalog when referring to compiled literal messages

**Catalog fragment**:
A subset of a compiled catalog delivered for part of an application.
_Avoid_: Namespace when referring to automatically selected message subsets

**Missing translation**:
A source message without a usable translation in the requested locale.
_Avoid_: Catalog loading failure

**Translation fallback**:
A message from a configured fallback locale or the source message used when
the requested translation is missing.
_Avoid_: Delivery recovery when referring to translation completeness

**Catalog delivery failure**:
A compiled catalog or fragment required by an application cannot be loaded.
_Avoid_: Missing translation

**Runtime catalog miss**:
A requested message is absent from the loaded compiled catalog even though
application execution requires it.
_Avoid_: Missing translation when describing an execution failure
