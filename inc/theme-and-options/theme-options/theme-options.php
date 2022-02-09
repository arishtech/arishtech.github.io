<?php
if ( !defined( 'ABSPATH' ) ) {
    exit; // Exit if accessed directly
}
//
// Set a unique slug-like ID
//
$restlyThemeOption = 'restly_Theme_Option';

//
// Create options
//
CSF::createOptions( $restlyThemeOption, array(
    'framework_title' => esc_html__('Restly Theme Options by Themepul','restly'),
    'menu_title'      => 'Theme Options',
    'menu_slug'       => 'theme-options',
    'menu_type'       => 'submenu',
    'menu_parent'     => 'themes.php',
    'class'           => 'restly-theme-option-wrapper',
    'defaults'        => restly_default_theme_options(),
) );

require_once 'general-options.php';
require_once 'typography-options.php';
require_once 'header-options.php';
// Create layout and options section
CSF::createSection( $restlyThemeOption, array(
    'title' => esc_html__( 'Layout & Options', 'restly' ),
    'id'    => 'restly_page_options',
    'icon'  => 'fa fa-calculator',
) );
require_once 'banner-options.php';
require_once 'blog-page-options.php';
require_once 'single-post-options.php';
require_once 'archive-page-options.php';
require_once 'search-page-options.php';
require_once 'error-page-options.php';
require_once 'portfolio-options.php';
require_once 'team-options.php';
require_once 'footer-options.php';
CSF::createSection( $restlyThemeOption, array(
    'title' => esc_html__( 'Code Editor', 'restly' ),
    'id'    => 'restly_code_editor_options',
    'icon'  => 'fa fa-code',
) );
CSF::createSection( $restlyThemeOption, array(
    'parent' => 'restly_code_editor_options',
    'title'  => esc_html__( 'CSS Editor', 'restly' ),
    'icon'   => 'fa fa-pencil-square-o',
    'fields' => array(
        array(
            'id'       => 'restly_css_editor',
            'type'     => 'code_editor',
            'title'    => esc_html__( 'CSS Editor', 'restly' ),
            'settings' => array(
                'theme' => 'mbo',
                'mode'  => 'css',
            ),
        ),
    ),
) );

// Field: backup
//
CSF::createSection( $restlyThemeOption, array(
    'title'       => esc_html__( 'Backup', 'restly' ),
    'icon'        => 'fas fa-shield-alt',
    'description' => esc_html__( 'Backup Theme Options all Data', 'restly' ),
    'fields'      => array(
        array(
            'type' => 'backup',
        ),
    ),
) );
