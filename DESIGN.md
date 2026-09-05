# Transcript take review

- **Surface:** dense desktop editor transcript panel.
- **Audience:** editors reviewing talking-head recordings; deleting a wrong phrase costs more than missing one.
- **Job:** preview suspected alternatives, keep one, explicitly confirm matched-word deletion.
- **Reuse:** `cc-tx-editbar`, `cc-tx-btn`, transcript frame projection, existing icon/button geometry and theme tokens.
- **States:** unavailable pack explains setup; scanning announces status; no safe groups is explicit; retry handles worker failures; possible overlaps are never bulk-deletable; confirmation lists the safety boundary.
- **Safety:** only strict groups expose Keep; confirmation deletes other members' matched half-open ranges, excluding already deleted words and stale generations.
- **Responsive:** the review section remains in normal transcript flow, wraps controls/text, and preserves native keyboard focus.
- **Checks:** semantic buttons, labelled live region, keyboard preview/keep, reduced-motion inherited from existing panel; contrast and assistive-technology behavior need desktop verification.
