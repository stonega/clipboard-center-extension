import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Register the same preferences resources used by GNOME's extensions service.
Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource')._register();
const { default: Preferences } = await import('../src/preferences.js');
const dir = Gio.File.new_for_path(ARGV[0]);
const [, contents] = dir.get_child('metadata.json').load_contents(null);
const metadata = { ...JSON.parse(new TextDecoder().decode(contents)), dir, path: ARGV[0] };
const preferences = new Preferences(metadata);
const app = new Adw.Application({ application_id: 'dev.stone.ClipboardCenterTest' });
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({
        application: app,
        default_width: 600,
        default_height: 700,
    });
    preferences.fillPreferencesWindow(window);
    if (window.get_visible_page().title !== 'Clipboard') {
        throw new Error('Preferences page was not created');
    }
    window.present();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
        print('PASS native Adwaita preferences open');
        window.close();
        app.quit();
        return GLib.SOURCE_REMOVE;
    });
});
app.run([]);
