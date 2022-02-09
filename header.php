<?php
/**
 * The header for our theme
 *
 * This is the template that displays all of the <head> section and everything up until <div id="content">
 *
 * @link https://developer.wordpress.org/themes/basics/template-files/#template-partials
 *
 * @package Restly
 */

?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<link rel="profile" href="https://gmpg.org/xfn/11">
	<?php 
	if(is_page() || is_singular('post') || is_singular('restly_portfolio') || is_singular('restly_team') && get_post_meta($post->ID, 'restly_metabox', true)) {
        $restlyMeta = get_post_meta($post->ID, 'restly_metabox', true);
    } else {
        $restlyMeta = array();
    }
    $restly_enable_preloader = restly_options('restly_enable_preloader', true);
    $restly_header_styles = restly_options('restly_header_styles');
    if (is_array($restlyMeta) && array_key_exists('restly_meta_select_header', $restlyMeta) && $restlyMeta['restly_meta_select_header'] != 'default' && $restlyMeta['restly_meta_enable_header'] == true ) {
        $selectedHeader = $restlyMeta['restly_meta_select_header'];
    } else if (!empty($restly_header_styles) && class_exists( 'CSF' )) {
        $selectedHeader = restly_options('restly_header_styles');
    } else {
        $selectedHeader = 'default';
    }
	wp_head(); ?>
</head>

<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<div id="page" class="site">
    <?php if($restly_enable_preloader == true ) { ?>
    <div class="preloader-area">
        <div class="loader"></div>
    </div>
    <?php } ?>
	<a class="skip-link screen-reader-text" href="#primary"><?php esc_html_e( 'Skip to content', 'restly' ); ?></a>
	<?php get_template_part( 'inc/header/header-'.$selectedHeader.'' ); ?>