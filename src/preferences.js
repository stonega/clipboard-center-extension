import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClipboardCenterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Clipboard',
            icon_name: 'edit-paste-symbolic',
        });
        const group = new Adw.PreferencesGroup({ title: 'Clipboard history' });
        page.add(group);

        const paused = new Adw.SwitchRow({
            title: 'Pause recording',
            subtitle: 'Keep existing history while recording is paused',
        });
        settings.bind('paused', paused, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(paused);

        const images = new Adw.SwitchRow({
            title: 'Include images',
            subtitle: 'Save copied PNG, JPEG, WebP, BMP, and TIFF images',
        });
        settings.bind('capture-images', images, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(images);

        const limit = Adw.SpinRow.new_with_range(5, 200, 5);
        limit.title = 'History size';
        limit.subtitle = 'Maximum regular history items, excluding favorites';
        settings.bind('history-limit', limit, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(limit);

        const privacy = new Adw.PreferencesGroup({ title: 'Stored on this desktop' });
        privacy.add(
            new Adw.ActionRow({
                title: 'History survives restarts',
                subtitle:
                    'Text, images, and favorites are saved locally without encryption, with access restricted to your account. History survives screen lock, logout, and reboot. Nothing is sent over the network.',
                subtitle_lines: 0,
            }),
        );
        privacy.add(
            new Adw.ActionRow({
                title: 'Sensitive content is skipped',
                subtitle:
                    'Password manager clipboard markers are respected. Unmarked secrets can still appear; pause recording before copying sensitive content.',
                subtitle_lines: 0,
            }),
        );
        privacy.add(
            new Adw.ActionRow({
                title: 'Memory limits',
                subtitle:
                    'Up to 1 MiB per text item, 16 MiB per image, and 64 MiB of clipboard data in total.',
                subtitle_lines: 0,
            }),
        );
        page.add(privacy);
        window.add(page);
    }
}
