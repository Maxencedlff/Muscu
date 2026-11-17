# Ajoute au projet Xcode, LE TEMPS DE LA CI, la cible de tests d'interface de l'Apple Watch
# (MDLFWatchUITests, ios/App/WatchUITests/) et un schéma partagé qui la lance.
# Rien n'est commité : le projet du dépôt reste celui de la build (empreinte « runtime » inchangée).
# Appelé par .github/workflows/montre.yml : ruby scripts/ios/add-watch-uitests.rb
require 'xcodeproj'

path = File.expand_path('../../ios/App/App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
watch = project.targets.find { |t| t.name == 'MDLFWatch' } or abort 'cible MDLFWatch introuvable'
abort 'cible MDLFWatchUITests déjà présente' if project.targets.any? { |t| t.name == 'MDLFWatchUITests' }

tests = project.new_target(:ui_test_bundle, 'MDLFWatchUITests', :watchos, '10.0')
group = project.main_group.find_subpath('WatchUITests', true)
group.set_source_tree('<group>')
group.set_path('WatchUITests')
tests.add_file_references([group.new_reference('WatchUITests.swift')])
tests.add_dependency(watch)
tests.build_configurations.each do |c|
  s = c.build_settings
  s['TEST_TARGET_NAME'] = 'MDLFWatch'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.mdlf.training.watchkitapp.uitests'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['SWIFT_VERSION'] = '5.0'
  s['SDKROOT'] = 'watchos'
  s['TARGETED_DEVICE_FAMILY'] = '4'
  s['WATCHOS_DEPLOYMENT_TARGET'] = '10.0'
  s['CODE_SIGN_STYLE'] = 'Automatic'
end
project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(watch)
scheme.add_test_target(tests)
scheme.set_launch_target(watch)
scheme.save_as(path, 'MDLFWatchUITests', true)
puts 'Cible MDLFWatchUITests et schéma ajoutés (CI seulement)'
