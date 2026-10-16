import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ClipboardHistory } from './clipboard.js';
import { ClipboardSection } from './section.js';

export default class ClipboardCenterExtension extends Extension {
    enable() {
        const dateMenu = Main.panel.statusArea.dateMenu;
        this._messageList = dateMenu._messageList;
        this._parent = this._messageList.get_parent();
        this._index = this._parent.get_children().indexOf(this._messageList);
        this._settings = this.getSettings();
        try {
            this._controller = new ClipboardHistory(this._settings, () => this._section?.sync());
            this._section = new ClipboardSection(this._controller);

            // Keep GNOME's notification list intact, below the clipboard section.
            this._column = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'message-list clipboard-center-column',
                x_expand: true,
                y_expand: true,
            });
            this._parent.remove_child(this._messageList);
            this._messageList.add_style_class_name('clipboard-center-notifications');
            this._column.add_child(this._section.actor);
            this._column.add_child(this._messageList);
            this._parent.insert_child_at_index(this._column, this._index);
            this._menu = dateMenu.menu;
            this._menuId = this._menu.connect('open-state-changed', (_menu, open) => {
                if (open) {
                    this._section.sync();
                } else {
                    this._section.reset();
                }
            });
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    disable() {
        if (this._menuId) {
            this._menu.disconnect(this._menuId);
            this._menuId = 0;
        }
        this._controller?.destroy();
        this._controller = null;
        if (this._messageList && this._column && this._messageList.get_parent() === this._column) {
            this._column.remove_child(this._messageList);
            this._parent.insert_child_at_index(this._messageList, this._index);
        }
        this._messageList?.remove_style_class_name('clipboard-center-notifications');
        this._section?.destroy();
        this._section = null;
        this._column?.destroy();
        this._column = null;
        this._messageList = null;
        this._parent = null;
        this._menu = null;
        this._settings = null;
    }
}
