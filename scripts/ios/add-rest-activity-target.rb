# frozen_string_literal: true

# Ajoute au projet Xcode la cible d'extension « RestActivity » (Live Activity du repos).
#
#   gem install --user-install xcodeproj
#   ruby scripts/ios/add-rest-activity-target.rb
#
# Ce que fait le script (équivalent de « File › New › Target › Widget Extension » d'Xcode,
# case « Include Live Activity ») :
#   - cible app_extension RestActivity (com.mdlf.training.RestActivity), iPhone, iOS 16.4 comme l'app ;
#   - sources ios/App/RestActivity/*.swift, catalogue d'images, Info.plist de l'extension ;
#   - ios/App/Shared/RestActivityAttributes.swift compilé dans l'app ET dans l'extension ;
#   - ios/App/App/LiveActivityPlugin.swift (module Capacitor qui pilote la Live Activity) dans l'app ;
#   - frameworks WidgetKit, SwiftUI, ActivityKit ;
#   - extension embarquée dans l'app (phase « Embed Foundation Extensions », dépendance de cible) ;
#   - signature : Debug automatique comme l'app (le contrôle CI compile sans signature),
#     Release manuelle (« Apple Distribution » + profil « MDLF Training Rest Activity App Store ») ;
#   - MARKETING_VERSION et CURRENT_PROJECT_VERSION remontés au niveau du projet : l'app et
#     l'extension partagent ainsi une seule valeur, comme l'exige App Store Connect.
#
# Idempotent : s'arrête sans rien modifier si la cible existe déjà.
# Réf. : https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
#        https://capacitorjs.com/docs/ios/custom-code

require 'xcodeproj'

ROOT        = File.expand_path('../..', __dir__)
PROJECT     = File.join(ROOT, 'ios/App/App.xcodeproj')
NAME        = 'RestActivity'
BUNDLE_ID   = 'com.mdlf.training.RestActivity'
TEAM        = 'NMK739Z59B'
IOS_TARGET  = '16.4'
PROFILE     = 'MDLF Training Rest Activity App Store'
EXT_SOURCES = %w[RestActivityBundle.swift RestLiveActivity.swift RestActivityViews.swift].freeze
SHARED      = 'RestActivityAttributes.swift'
APP_PLUGIN  = 'LiveActivityPlugin.swift'

project = Xcodeproj::Project.open(PROJECT)
if project.targets.any? { |t| t.name == NAME }
  puts "La cible #{NAME} existe déjà : rien à faire."
  exit 0
end
app = project.targets.find { |t| t.name == 'App' } or abort('Cible App introuvable')

# ── Versions : une seule source pour l'app et l'extension ─────────────
versions = {}
app.build_configurations.each do |config|
  %w[MARKETING_VERSION CURRENT_PROJECT_VERSION].each do |key|
    value = config.build_settings.delete(key)
    versions[key] ||= value if value
  end
end
project.build_configurations.each do |config|
  config.build_settings['MARKETING_VERSION']       = versions['MARKETING_VERSION'] || '1.0'
  config.build_settings['CURRENT_PROJECT_VERSION'] = versions['CURRENT_PROJECT_VERSION'] || '1'
end

# ── Fichiers ──────────────────────────────────────────────────────────
shared_group = project.main_group.find_subpath('Shared', false) ||
               project.main_group.new_group('Shared', 'Shared')
shared_ref = shared_group.files.find { |f| f.path == SHARED } || shared_group.new_reference(SHARED)

ext_group  = project.main_group.new_group(NAME, NAME)
ext_refs   = EXT_SOURCES.map { |file| ext_group.new_reference(file) }
assets_ref = ext_group.new_reference('Assets.xcassets')
ext_group.new_reference('Info.plist')

# ── Cible d'extension ─────────────────────────────────────────────────
ext = project.new_target(:app_extension, NAME, :ios, IOS_TARGET, nil, :swift)
ext.add_file_references(ext_refs + [shared_ref])
ext.add_resources([assets_ref])
ext.add_system_frameworks(%w[WidgetKit SwiftUI ActivityKit])
# Chemins relatifs au SDK (comme Xcode), et non à une version précise d'Xcode : le projet doit se
# compiler avec n'importe quel Xcode 26.x de la CI
ext.frameworks_build_phase.files_references.each do |ref|
  ref.source_tree = 'SDKROOT'
  ref.path = "System/Library/Frameworks/#{ref.name}"
end
app_group  = project.main_group.find_subpath('App', false) or abort('Groupe App introuvable')
plugin_ref = app_group.files.find { |f| f.path == APP_PLUGIN } || app_group.new_reference(APP_PLUGIN)
app.add_file_references([shared_ref, plugin_ref])

common = {
  'PRODUCT_NAME'                  => '$(TARGET_NAME)',
  'PRODUCT_BUNDLE_IDENTIFIER'     => BUNDLE_ID,
  'INFOPLIST_FILE'                => "#{NAME}/Info.plist",
  'GENERATE_INFOPLIST_FILE'       => 'NO',
  'DEVELOPMENT_TEAM'              => TEAM,
  'IPHONEOS_DEPLOYMENT_TARGET'    => IOS_TARGET,
  'TARGETED_DEVICE_FAMILY'        => '1',
  'SWIFT_VERSION'                 => '5.0',
  'SKIP_INSTALL'                  => 'YES',
  'APPLICATION_EXTENSION_API_ONLY' => 'YES',
  'ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS' => 'NO',
  'LD_RUNPATH_SEARCH_PATHS'       => ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks'],
}.freeze

ext.build_configurations.each do |config|
  settings = config.build_settings
  settings.merge!(common)
  if config.name == 'Release'
    settings['CODE_SIGN_STYLE']                = 'Manual'
    settings['CODE_SIGN_IDENTITY']             = 'Apple Distribution'
    settings['PROVISIONING_PROFILE_SPECIFIER'] = PROFILE
  else
    settings['CODE_SIGN_STYLE']                = 'Automatic'
  end
end

# ── Extension embarquée dans l'app ────────────────────────────────────
app.add_dependency(ext)
embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' } ||
        app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
build_file = embed.add_file_reference(ext.product_reference, true)
build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save
puts "Cible #{NAME} ajoutée (#{BUNDLE_ID}), embarquée dans App."
