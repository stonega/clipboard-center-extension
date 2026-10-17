import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';

import { ClipboardExpanderLayout, ClipboardStack, EXPANSION_TIME } from './expander.js';
import { textPreview } from './history.js';

const PAGE_SIZE = 10;

const ClipboardMessage = GObject.registerClass(
    class ClipboardCenterMessage extends MessageList.Message {
        canClose() {
            return true;
        }
    },
);

export class ClipboardSection {
    constructor(controller) {
        this._controller = controller;
        this._expanded = false;
        this._animating = false;
        this._page = 0;
        this._pageCount = 1;
        this.actor = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'message-notification-group clipboard-center-section',
            x_expand: true,
            y_expand: false,
        });
        this._controls = new St.Widget({
            layout_manager: new ClipboardExpanderLayout(),
            x_expand: true,
            clip_to_allocation: true,
        });
        this.actor.add_child(this._controls);
        this._header = new St.BoxLayout({
            style_class: 'message-group-header',
            x_expand: true,
        });
        this._header.add_child(
            new St.Label({
                style_class: 'message-group-title',
                text: 'Clipboard',
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        this._collapseButton = new St.Button({
            style_class: 'message-collapse-button',
            icon_name: 'group-collapse-symbolic',
            accessible_name: 'Collapse clipboard history',
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        this._collapseButton.connect('clicked', () => this._setExpanded(false));
        this._header.add_child(this._collapseButton);
        this._controls.add_child(this._header);

        this._search = new St.Entry({
            style_class: 'search-entry clipboard-center-search',
            hint_text: 'Search text and images…',
            can_focus: true,
            x_expand: true,
            primary_icon: new St.Icon({ icon_name: 'edit-find-symbolic', icon_size: 16 }),
        });
        this._search.clutter_text.connect('text-changed', () => {
            this._page = 0;
            this._scroll.vadjustment.value = 0;
            this._renderItems();
        });
        this._controls.add_child(this._search);

        this._content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'clipboard-center-items',
            x_expand: true,
        });
        this._favorites = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'clipboard-center-items clipboard-center-favorites',
            x_expand: true,
        });
        this._content.add_child(this._favorites);

        this._stack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: false,
            style_class: 'clipboard-center-stack',
        });
        this._content.add_child(this._stack);
        this._backCards = [2, 1].map((depth) => {
            const card = new St.Widget({
                style_class: `message clipboard-center-back clipboard-center-back-${depth}`,
                x_expand: true,
                y_expand: true,
            });
            card.add_style_pseudo_class(depth === 1 ? 'second-in-stack' : 'lower-in-stack');
            this._stack.add_child(card);
            return card;
        });
        this._items = new ClipboardStack({
            layout_manager: new ClipboardExpanderLayout(true),
            style_class: 'clipboard-center-items',
            x_expand: true,
            clip_to_allocation: true,
        });
        this._stack.add_child(this._items);
        this._scroll = new St.ScrollView({
            style_class: 'clipboard-center-scroll',
            x_expand: true,
            y_expand: false,
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.EXTERNAL,
            child: this._content,
        });
        this.actor.add_child(this._scroll);

        this._pagination = new St.BoxLayout({
            style_class: 'clipboard-center-pagination',
            x_expand: true,
        });
        this._previousPageButton = new St.Button({
            style_class: 'button clipboard-center-page-button',
            label: 'Previous',
            accessible_name: 'Previous clipboard page',
            can_focus: true,
        });
        this._previousPageButton.connect('clicked', () => this._changePage(-1));
        this._pagination.add_child(this._previousPageButton);
        this._pageLabel = new St.Label({
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pagination.add_child(this._pageLabel);
        this._nextPageButton = new St.Button({
            style_class: 'button clipboard-center-page-button',
            label: 'Next',
            accessible_name: 'Next clipboard page',
            can_focus: true,
        });
        this._nextPageButton.connect('clicked', () => this._changePage(1));
        this._pagination.add_child(this._nextPageButton);
        this.actor.add_child(this._pagination);

        // Cover the whole collapsed stack, including card controls and exposed edges.
        this._expandCover = new St.Button({
            style_class: 'clipboard-center-expand-cover',
            can_focus: true,
            x_expand: true,
            y_expand: true,
            accessible_name: 'Expand clipboard history',
        });
        this._expandCover.connect('clicked', () => this._setExpanded(true));
        this._expandCover.connect('notify::hover', () => this._syncStackHover());
        this._stack.add_child(this._expandCover);
        this.sync();
    }

    _syncStackHover() {
        const message = this._items.get_first_child();
        if (!(message instanceof ClipboardMessage)) return;
        if (this._expanded) {
            message.sync_hover();
        } else {
            // The cover receives pointer events; let the card use Shell's :hover style.
            message.hover = this._expandCover.visible && this._expandCover.hover;
        }
    }

    _stopExpansion() {
        for (const actor of [this._controls, this._items]) {
            actor.remove_transition('@layout.expansion');
        }
        this._controls.remove_transition('opacity');
        this._animating = false;
    }

    _setExpanded(expanded, animate = true) {
        if (expanded === this._expanded && animate) return;
        this._stopExpansion();
        this._expanded = expanded;
        this._animating = animate && this.actor.mapped;
        if (!expanded) {
            this._page = 0;
            this._search.set_text('');
            this._scroll.vadjustment.value = 0;
        }
        this.sync(true);
        const target = expanded ? 1 : 0;
        const duration = this._animating ? EXPANSION_TIME : 0;
        this._controls.ease_property('@layout.expansion', target, {
            duration,
            progress_mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._controls.ease({
            opacity: expanded ? 255 : 0,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._items.ease_property('@layout.expansion', target, {
            duration,
            progress_mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._animating = false;
                this._controls.visible = expanded;
                this._header.visible = expanded;
                this._search.visible = expanded;
                if (!expanded) {
                    this._renderItems(true);
                    if (animate && this.actor.mapped) {
                        if (this._expandCover.visible) {
                            this._expandCover.grab_key_focus();
                        } else {
                            this._favorites.get_first_child()?.grab_key_focus();
                        }
                    }
                }
            },
        });
        if (expanded) {
            this._search.grab_key_focus();
        }
    }

    sync(preserveMessages = false) {
        this._controls.visible = this._expanded || this._animating;
        this._header.visible = this._controls.visible;
        this._search.visible = this._controls.visible;
        this._renderItems(preserveMessages);
    }

    _changePage(direction) {
        const page = Math.max(0, Math.min(this._page + direction, this._pageCount - 1));
        if (!this._expanded || page === this._page) return;
        this._page = page;
        this._scroll.vadjustment.value = 0;
        this._renderItems(true);
    }

    _syncPagination() {
        const focused = this._previousPageButton.has_key_focus()
            ? this._previousPageButton
            : this._nextPageButton.has_key_focus()
              ? this._nextPageButton
              : null;
        this._pagination.visible = this._expanded && this._pageCount > 1;
        this._pageLabel.text = `Page ${this._page + 1} of ${this._pageCount}`;
        for (const [button, enabled] of [
            [this._previousPageButton, this._page > 0],
            [this._nextPageButton, this._page < this._pageCount - 1],
        ]) {
            button.reactive = enabled;
            button.can_focus = enabled && this._pagination.visible;
            button.opacity = enabled ? 255 : 128;
        }
        if (focused && (!this._pagination.visible || !focused.reactive)) {
            if (this._pagination.visible) {
                (this._nextPageButton.reactive
                    ? this._nextPageButton
                    : this._previousPageButton
                ).grab_key_focus();
            } else if (this._expanded) {
                this._search.grab_key_focus();
            }
        }
    }

    _renderItems(preserveMessages = false) {
        const previous = new Map();
        for (const container of [this._items, this._favorites]) {
            for (const card of container.get_children()) {
                if (preserveMessages && card.clipboardItemId) {
                    previous.set(card.clipboardItemId, card);
                    container.remove_child(card);
                } else {
                    card.destroy();
                }
            }
        }
        const matches = this._controller.history.search(this._search.get_text());
        const favorites = matches.filter((item) => item.favorite);
        const items = matches.filter((item) => !item.favorite);
        this._pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
        if (this._page >= this._pageCount) {
            this._page = this._pageCount - 1;
            this._scroll.vadjustment.value = 0;
        }
        const shown =
            this._expanded || this._animating
                ? items.slice(this._page * PAGE_SIZE, (this._page + 1) * PAGE_SIZE)
                : items.slice(0, 1);
        this._syncPagination();
        const depth = Math.min(2, Math.max(0, items.length - 1));
        this._backCards[0].visible = !this._expanded && !this._animating && depth === 2;
        this._backCards[1].visible = !this._expanded && !this._animating && depth >= 1;
        this._favorites.visible = favorites.length > 0;
        this._stack.visible = shown.length > 0 || favorites.length === 0;
        this._expandCover.visible = !this._expanded && items.length > 0;
        this._scroll.style = `max-height: ${this._expanded || this._animating || favorites.length > 0 ? 340 : 180}px;`;
        // The resting stack only retains its top card; keep the back-card reveal.
        this._items.style = `margin-bottom: ${!this._expanded && !this._animating ? depth * 6 : 0}px;`;
        this._backCards[1].style = `margin-bottom: ${Math.max(0, depth - 1) * 6}px;`;
        for (const [container, entries] of [
            [this._favorites, favorites],
            [this._items, shown],
        ]) {
            for (const [index, item] of entries.entries()) {
                const message = previous.get(item.id) ?? this._createMessage(item);
                previous.delete(item.id);
                this._updateMessageInteractivity(message, item);
                for (const pseudo of ['second-in-stack', 'lower-in-stack']) {
                    message.remove_style_pseudo_class(pseudo);
                }
                if (container === this._items && !this._expanded && index > 0) {
                    message.add_style_pseudo_class(
                        index === 1 ? 'second-in-stack' : 'lower-in-stack',
                    );
                }
                container.add_child(message);
                if (!this._expanded && message.expanded) message.unexpand(this._animating);
            }
        }
        for (const card of previous.values()) card.destroy();
        if (matches.length === 0) {
            const paused = this._controller.settings.get_boolean('paused');
            this._items.add_child(
                new St.Label({
                    style_class: 'clipboard-center-empty',
                    text: this._search.get_text().trim()
                        ? 'No matching items'
                        : paused
                          ? 'Recording paused. Your history stays here.'
                          : 'Copy text or an image to get started.',
                    x_expand: true,
                }),
            );
        }
        this._syncStackHover();
    }

    _createMessage(item) {
        const isImage = item.kind === 'image';
        const source = new MessageList.Source({
            title: isImage ? 'Image' : 'Text',
            icon: new Gio.ThemedIcon({
                name: isImage ? 'image-x-generic-symbolic' : 'text-x-generic-symbolic',
            }),
        });
        const message = new ClipboardMessage(source);
        message.clipboardItemId = item.id;
        message.add_style_class_name('clipboard-center-message');
        if (item.favorite) {
            message.add_style_class_name('clipboard-center-favorite');
        }
        message.datetime = GLib.DateTime.new_from_unix_local(item.capturedAt / 1000);
        message._header.closeButton.accessible_name = 'Remove from clipboard history';
        message._header.expandButton.accessible_name = 'Expand preview';
        message._bodyLabel.reactive = false;

        message.favoriteButton = new St.Button({
            style_class: 'message-expand-button clipboard-center-favorite-button',
            icon_name: item.favorite ? 'starred-symbolic' : 'non-starred-symbolic',
            accessible_name: item.favorite ? 'Remove from favorites' : 'Add to favorites',
            toggle_mode: true,
            checked: item.favorite,
            y_align: Clutter.ActorAlign.CENTER,
        });
        message._header.insert_child_above(message.favoriteButton, message._header.expandButton);
        message.favoriteButton.connect('clicked', () => {
            this._controller.toggleFavorite(item.id);
            const updated = [...this._favorites.get_children(), ...this._items.get_children()].find(
                (card) => card.clipboardItemId === item.id,
            );
            if (!this._expanded && !item.favorite && this._expandCover.visible) {
                this._expandCover.grab_key_focus();
            } else {
                updated?.favoriteButton.grab_key_focus();
            }
        });

        if (isImage) {
            const icon = new Gio.BytesIcon({ bytes: item.bytes });
            message.icon = icon;
            message.title = `${item.mime.split('/')[1].toUpperCase()} image`;
            message.setActionArea(
                new St.Icon({
                    gicon: icon,
                    icon_size: 220,
                    style_class: 'clipboard-center-image-preview',
                    x_align: Clutter.ActorAlign.CENTER,
                    accessible_name: 'Copied image preview',
                }),
            );
        }
        message.connect('close', () => this._controller.remove(item.id));
        message.connect('clicked', () => {
            if (!this._expanded && !item.favorite) {
                this._setExpanded(true);
                return;
            }
            try {
                this._controller.copy(item);
                Main.panel.statusArea.dateMenu.menu.close();
            } catch (error) {
                console.error(`Clipboard Center: could not copy item (${error.name})`);
            }
        });
        return message;
    }

    _updateMessageInteractivity(message, item) {
        const interactive = this._expanded || item.favorite;
        message.can_focus = interactive;
        message._header.closeButton.can_focus = interactive;
        message._header.expandButton.can_focus = interactive;
        message.favoriteButton.can_focus = interactive;
        const hint = interactive ? '' : 'Click to expand history';
        if (item.kind === 'image') {
            message.body = [GLib.format_size(item.size), hint].filter(Boolean).join(' · ');
        } else {
            const preview = textPreview(item.text, hint);
            message.title = preview.title;
            message.body = preview.body;
        }
        message.accessible_name = interactive
            ? `Copy ${item.kind === 'image' ? 'image' : textPreview(item.text).title}`
            : 'Expand clipboard history';
    }

    reset() {
        this._setExpanded(false, false);
    }

    destroy() {
        this._stopExpansion();
        this.actor.destroy();
    }
}
