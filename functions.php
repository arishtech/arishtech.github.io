<?php
/**
 * Restly functions and definitions
 *
 * @link https://developer.wordpress.org/themes/basics/theme-functions/
 *
 * @package Restly
 */

if ( ! defined( '_S_VERSION' ) ) {
	// Replace the version number of the theme on each release.
	define( '_S_VERSION', '1.0.0' );
}

// Inc folder directory
define('RESTLY_INC_DIR', get_template_directory() . '/inc/');

// Theme Default Setup
require_once RESTLY_INC_DIR . 'theme-setup.php';

//  Register widget area
require_once RESTLY_INC_DIR . 'widget-area-ini.php';
//  Comments Template
require_once RESTLY_INC_DIR . 'comments-template.php';
/**
 * TGM Plugin 
 */
require_once RESTLY_INC_DIR . 'plugins-activation.php';
//  Script and Css Load
require_once RESTLY_INC_DIR . 'css-and-js.php';

/** Implement the Custom Header feature.*/
require_once RESTLY_INC_DIR . 'custom-header.php';

/** Custom template tags for this theme. */
require_once RESTLY_INC_DIR . 'template-tags.php';

/** Functions which enhance the theme by hooking into WordPress */
require_once RESTLY_INC_DIR . 'template-functions.php';
require_once RESTLY_INC_DIR . 'restly-default-options.php';
require_once RESTLY_INC_DIR . 'nav-menu-walker.php';

/** Customizer additions. */
require_once RESTLY_INC_DIR . 'customizer.php';

if( class_exists( 'CSF' ) ) {
	require_once RESTLY_INC_DIR . 'theme-and-options/metabox-and-options.php';
}
if( class_exists( 'CSF' ) && has_nav_menu( 'mainmenu' ) ) {
	require_once RESTLY_INC_DIR . 'inline-css.php';
}
