# Test d'interface iPad (docs/COACH_IPAD.md, « Test dans la vraie vue web ») : ajoute au projet Xcode, LE TEMPS DU
# TEST SEULEMENT (ios.yml, mode contrôle), une cible de tests d'interface MDLFUITests (ios/App/UITests/) et son schéma.
# Le projet commité n'a jamais cette cible : l'empreinte native (scripts/runtime-version.mjs) et la build TestFlight
# ne changent pas. Demande la gemme xcodeproj (celle de CocoaPods).
#   ruby scripts/ios/add-ui-tests.rb
require 'xcodeproj'

path = File.expand_path('../../ios/App/App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
abort 'MDLFUITests déjà dans le projet' if project.targets.any? { |t| t.name == 'MDLFUITests' }
app = project.targets.find { |t| t.name == 'App' } or abort 'cible App introuvable'

target = project.new_target(:ui_test_bundle, 'MDLFUITests', :ios, '16.4', nil, :swift)
group = project.main_group.new_group('UITests', 'UITests')
target.add_file_references([group.new_reference('CoachIpadUITests.swift')])
target.add_dependency(app)
target.build_configurations.each do |c|
  c.build_settings.merge!(
    'TEST_TARGET_NAME' => 'App',
    'PRODUCT_NAME' => 'MDLFUITests',
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.mdlf.training.uitests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'SWIFT_VERSION' => '5.0',
    'IPHONEOS_DEPLOYMENT_TARGET' => '16.4',
    'CODE_SIGNING_ALLOWED' => 'NO',
  )
end
project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(target)
scheme.set_launch_target(app)
scheme.save_as(path, 'MDLFUITests', true)
puts 'MDLFUITests ajoutée au projet (le temps du test)'
