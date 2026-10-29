/**
 * The clinic system's component kit (design system v1 – docs/clinic-system/design/). Presentational only: no data
 * fetching, no server imports. Every module's screens build on these; ClinForms keeps src/components/ui.
 * Preview of every component with the design's examples: /app/clinic/design-system (owners and administrators).
 */
export { PmsButton, pmsButtonVariants, Spinner, type PmsButtonProps } from "./button";
export { FormField, type FormFieldProps, type FieldAria } from "./form-field";
export { TextInput, SelectInput, TextArea, IconInput, InlineKbd, Checkbox, Radio, Switch, inputClasses, type IconInputProps, type ChoiceProps, type SwitchProps } from "./inputs";
export { StatusPill, FlagPill, type StatusPillProps, type FlagPillProps } from "./status-pill";
export { statusStyle, TONE_CLASSES, APPOINTMENT_STATUS_STYLES, INVOICE_STATUS_STYLES, NOTE_STATUS_STYLES, type StatusKind, type StatusStyle, type StatusTone, type StatusIcon } from "./status";
export { StatusIconGlyph } from "./status-icon";
export { DiaryBlock, type DiaryBlockProps } from "./diary-block";
export { diaryBlockStyle, isCollapsedBlock, blockMinutes, minutesOf, COLLAPSE_MAX_MINUTES, type DiaryBlockStatus, type DiaryBlockStyle } from "./diary-block-model";
export { DataTable, DataCard, type DataTableProps, type DataTableColumn, type SortState, type SortDirection } from "./data-table";
export { FilterBar, FilterSearch, FilterAddButton, FilterChip, ClearFilters, type FilterSearchProps } from "./filters";
export { Pagination, type PaginationProps } from "./pagination";
export { pageItems, totalPagesOf, showingText, type PageItem } from "./pagination-model";
export { UnderlineTabs, UnderlineTabsList, UnderlineTabsTrigger, UnderlineTabsContent } from "./underline-tabs";
export { SkeletonBar, SkeletonRows } from "./skeleton";
export { PmsNotice, type PmsNoticeProps, type NoticeTone } from "./notice";
export { ToastProvider, ToastCard, useToast, TOAST_DURATION_MS, type ToastApi, type ToastOptions, type ToastAction } from "./toast";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { ErrorState, type ErrorStateProps } from "./error-state";
export { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";
export { SideDrawer, type SideDrawerProps } from "./side-drawer";
export { SiteSwitcher, ALL_SITES, type SiteSwitcherProps, type SiteOption } from "./site-switcher";
export { PmsAvatar, type PmsAvatarProps, type AvatarSize } from "./pms-avatar";
export { avatarColour, initialsOf, AVATAR_COLOURS, type AvatarColour } from "./avatar-colour";
export { Kbd, KeyboardHint, ShortcutsSheet, type ShortcutsSheetProps } from "./keyboard-hint";
export { GLOBAL_SHORTCUTS, DIARY_SHORTCUTS, isTypingTarget, isPlainKey, type Shortcut, type ShortcutGroup } from "./shortcuts";
export { ContextMenu, isContextMenuKey, pointOf, type ContextMenuItem, type ContextMenuProps } from "./context-menu";
export { nextMenuIndex, typeaheadIndex, placeMenu, type MenuKey } from "./menu-model";
export { useModalLayer, inertOutside } from "./modal-layer";
